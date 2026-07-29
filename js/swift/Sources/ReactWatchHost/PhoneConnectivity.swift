// watchOS-only host (WatchKit/UIKit/HealthKit/SwiftUI). The #if compiles this
// file to an empty module off-watchOS so `swift test` runs on macOS — see Package.swift.
#if os(watchOS)
import Foundation
import ReactWatchSupport
import WatchConnectivity

/// A sendToPhone failure, mapped to a generic invoke error `code` (SD-1) with
/// the WCError detail in `message`. Sendable so it can cross WCSession's
/// background-queue handlers back to the main actor.
struct SendError: Error, Sendable {
    let code: InvokeErrorCode
    let message: String
}

/// Bridges WatchConnectivity to the JS native-event channel, split by
/// delivery semantics (ARCH-12): interactive messages push as
/// "watchConnectivity", latest-wins state as
/// "watchConnectivity.applicationContext", and queued background transfers as
/// "watchConnectivity.userInfo" — each channel has different guarantees, and
/// merging them forced JS to guess which one fired. Outbound mirrors the same
/// split: `send` (reachable-only, reply/error), `updateApplicationContext`
/// (latest-wins, delivered when the phone wakes), `transferUserInfo` (FIFO
/// queue, survives suspension).
/// NOTE: untested until built with Xcode on macOS. The paired iPhone app
/// (the Expo companion) needs its own WCSession wiring to talk back.
final class PhoneConnectivity: NSObject, WCSessionDelegate {
    /// Called on the main queue with (event, payload) for each inbound push.
    var onPush: ((_ event: String, _ payload: [String: Any]) -> Void)?
    /// Called on the main queue when a delivery could not be completed at all
    /// (an inbound file the inbox couldn't adopt). The model turns it into a
    /// recoverable `connectivity` diagnostic — a dropped file must not be
    /// silent (rule 12), and there is no invoke to reject: nobody asked.
    var onError: ((_ code: String, _ details: String) -> Void)?

    /// The correlation the JS API is built on. `WCSessionFileTransfer` has no
    /// identity property of its own ("You do not create instances of this
    /// class yourself"), so the id is ours: minted here, on the BRIDGE, and
    /// deliberately NOT reset per JS generation.
    ///
    /// That is the opposite of `BluetoothBridge.resetPendingForReload()`, and
    /// for a reason worth stating: BLE ids come from the RUNTIME's id space,
    /// which restarts at 1 on every boot, so a late delegate could settle a
    /// *different* promise that happened to reuse an id. These ids are minted
    /// by this object, which outlives every runtime generation, so they are
    /// never reused — a `didFinish` from a previous generation carries an id
    /// the new generation simply never issued, and its listener ignores it.
    /// Strictly safer than reuse, so no reset hook exists.
    ///
    /// The honest limit, documented on the JS side too: a transfer queued in a
    /// previous LAUNCH reappears in `outstandingFileTransfers` with no id we
    /// minted, and is reported (and completes) as `id: null`.
    private var nextTransferId = 1
    private var idsByTransfer: [ObjectIdentifier: Int] = [:]
    /// The strong reference `cancel()` needs, keyed by our id.
    private var transfersById: [Int: WCSessionFileTransfer] = [:]
    /// `transferFile` is called on main (invoke dispatch); `didFinish` arrives
    /// on a background thread. Both touch the two maps above.
    private let transferLock = NSLock()

    /// Monotonic per-process counter for RECEIVED files; pairs with the
    /// receipt timestamp to make an inbox filename unique across launches.
    private var nextReceiveSequence = 1

    /// Where inbound files land. Resolved once: `session(_:didReceive:)` must
    /// do its work synchronously, so it is not the place to go looking for a
    /// container directory.
    private let inbox = FileInbox.applicationSupport()

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /// Sends a message and reports the result (CX-022): resolves the phone's
    /// reply (JSON), rejects when the phone isn't reachable or on a WCError.
    /// `replyHandler`/`errorHandler` fire on a background queue, so `completion`
    /// is @Sendable and delivers only Sendable values (the caller hops to main).
    func send(
        _ json: String,
        completion: @escaping @Sendable (Result<String, SendError>) -> Void
    ) {
        guard WCSession.isSupported() else {
            completion(
                .failure(
                    SendError(
                        code: .unavailable, message: "WatchConnectivity is not supported")))
            return
        }
        let session = WCSession.default
        guard let data = json.data(using: .utf8),
            let message = (try? JSONSerialization.jsonObject(with: data))
                as? [String: Any]
        else {
            completion(
                .failure(
                    SendError(
                        code: .invalidRequest, message: "message is not a JSON object")))
            return
        }
        // sendMessage is the only API with a reply/error pair, and it needs the
        // phone reachable — pre-check so "not reachable" is a clean reject.
        guard session.isReachable else {
            completion(
                .failure(
                    SendError(
                        code: .unavailable, message: "the iPhone is not reachable")))
            return
        }
        session.sendMessage(
            message,
            replyHandler: { reply in
                let replyJson =
                    (try? JSONSerialization.data(withJSONObject: reply))
                    .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
                completion(.success(replyJson))
            },
            errorHandler: { error in
                completion(
                    .failure(
                        SendError(
                            code: Self.invokeCode(for: error),
                            message: error.localizedDescription)))
            })
    }

    /// Latest-wins background state sync: hands the JSON object to
    /// WCSession.updateApplicationContext — the phone gets the MOST RECENT
    /// context when it next wakes (no queue, no reachability requirement).
    /// Returns nil on success, the invoke-shaped error otherwise. Synchronous:
    /// the hand-off either succeeds or throws immediately.
    func updateApplicationContext(_ json: String) -> SendError? {
        switch validatedSession(json) {
        case .failure(let error): return error
        case .success((let session, let object)):
            do {
                try session.updateApplicationContext(object)
                return nil
            } catch {
                return SendError(
                    code: Self.invokeCode(for: error),
                    message: error.localizedDescription)
            }
        }
    }

    /// FIFO queued background transfer: WCSession delivers every queued
    /// userInfo in order when the counterpart wakes; the queue survives app
    /// suspension. Returns nil once queued (delivery itself is asynchronous
    /// and not observable per-item here).
    func transferUserInfo(_ json: String) -> SendError? {
        switch validatedSession(json) {
        case .failure(let error): return error
        case .success((let session, let object)):
            session.transferUserInfo(object)
            return nil
        }
    }

    /// One queued outbound file transfer: the id JS tracks it by, and the byte
    /// size the caller's soft budget is checked against.
    struct QueuedFileTransfer: Sendable {
        let id: Int
        let bytes: Int
    }

    /// Queues a file for the paired iPhone and returns ONCE QUEUED — delivery
    /// is reported later on the `watchConnectivity.fileTransfer` push channel,
    /// possibly in a different launch. `WCSession.transferFile` is documented
    /// as asynchronous, throttled "to accommodate performance and power
    /// concerns", and surviving suspension, so parking the invoke on delivery
    /// would blow the 30 s watchdog on every single call.
    func transferFile(_ json: String) -> Result<QueuedFileTransfer, SendError> {
        guard WCSession.isSupported() else {
            return .failure(
                SendError(
                    code: .unavailable, message: "WatchConnectivity is not supported"))
        }
        let session = WCSession.default
        // Not politeness — Apple: "This method can only be called while the
        // session is active. Calling this method for an inactive or deactivated
        // session is a programmer error." A JS call must not be able to trip a
        // native programmer error, so this guard is what makes the op safe.
        guard session.activationState == .activated else {
            return .failure(
                SendError(code: .unavailable, message: "the session is not activated"))
        }
        guard let data = json.data(using: .utf8),
            let object = (try? JSONSerialization.jsonObject(with: data))
                as? [String: Any],
            let path = object["path"] as? String, !path.isEmpty
        else {
            return .failure(
                SendError(
                    code: .invalidRequest, message: "transferFile needs a `path`"))
        }
        let url =
            path.hasPrefix("file://")
            ? (URL(string: path) ?? URL(fileURLWithPath: path))
            : URL(fileURLWithPath: path)
        // Read the size AND prove the file exists in one call: WCSession
        // reports an unreadable file only much later, through `didFinish`'s
        // error, which the caller has no invoke left to receive it on.
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        guard let bytes = attributes?[.size] as? Int else {
            return .failure(
                SendError(
                    code: .invalidRequest,
                    message: "no readable file at \(url.path)"))
        }
        let transfer = session.transferFile(
            url, metadata: object["metadata"] as? [String: Any])
        transferLock.lock()
        let id = nextTransferId
        nextTransferId += 1
        idsByTransfer[ObjectIdentifier(transfer)] = id
        transfersById[id] = transfer
        transferLock.unlock()
        return .success(QueuedFileTransfer(id: id, bytes: bytes))
    }

    /// Cancels a transfer this launch queued. An id this launch never minted
    /// is a caller error, not a silent no-op — including the real case of a
    /// transfer queued by a PREVIOUS launch, which has no id to cancel by.
    func cancelFileTransfer(_ json: String) -> SendError? {
        guard let data = json.data(using: .utf8),
            let object = (try? JSONSerialization.jsonObject(with: data))
                as? [String: Any],
            let id = object["id"] as? Int
        else {
            return SendError(
                code: .invalidRequest, message: "cancelFileTransfer needs an `id`")
        }
        transferLock.lock()
        let transfer = transfersById[id]
        transferLock.unlock()
        guard let transfer else {
            return SendError(
                code: .invalidRequest,
                message: "no file transfer with id \(id) was queued by this launch")
        }
        transfer.cancel()
        return nil
    }

    /// Every transfer WCSession still has queued. `id` is omitted for one this
    /// launch didn't mint (see `nextTransferId`).
    func outstandingTransfers() -> [[String: Any]] {
        guard WCSession.isSupported() else { return [] }
        let transfers = WCSession.default.outstandingFileTransfers
        transferLock.lock()
        let known = idsByTransfer
        transferLock.unlock()
        return transfers.map { transfer in
            var entry: [String: Any] = [
                "name": transfer.file.fileURL.lastPathComponent,
                "transferring": transfer.isTransferring,
                "fractionCompleted": transfer.progress.fractionCompleted,
            ]
            if let id = known[ObjectIdentifier(transfer)] { entry["id"] = id }
            return entry
        }
    }

    /// A snapshot of the session for OBSERVABILITY. `isReachable` is reported,
    /// never used as a gate: Apple states it is "valid only for a configured
    /// session that has been activated successfully", and
    /// notes/watchconnectivity-reliability.md records it returning true while
    /// delivery fails. `send` still pre-checks it because `sendMessage` is the
    /// one API that genuinely requires it.
    func connectivityState() -> [String: Any] {
        guard WCSession.isSupported() else {
            return [
                "activationState": "notActivated",
                "reachable": false,
                "companionAppInstalled": false,
                "hasContentPending": false,
            ]
        }
        let session = WCSession.default
        return [
            "activationState": Self.activationName(session.activationState),
            "reachable": session.isReachable,
            "companionAppInstalled": session.isCompanionAppInstalled,
            "hasContentPending": session.hasContentPending,
        ]
    }

    /// Deletes a file this app received, by the path the `watchConnectivity.file`
    /// event handed JS. The containment check lives in `FileInbox.resolve`
    /// (Linux-tested): a path outside the inbox is refused rather than deleted.
    func deleteReceivedFile(_ json: String) -> SendError? {
        guard let data = json.data(using: .utf8),
            let object = (try? JSONSerialization.jsonObject(with: data))
                as? [String: Any],
            let path = object["path"] as? String
        else {
            return SendError(
                code: .invalidRequest, message: "deleteReceivedFile needs a `path`")
        }
        guard let inbox, let url = inbox.resolve(path: path) else {
            return SendError(
                code: .invalidRequest,
                message: "\(path) is not a file this app received")
        }
        // An already-deleted file resolves: `delete` is how an app releases a
        // file it has consumed, and the native prune may have got there first.
        try? FileManager.default.removeItem(at: url)
        return nil
    }

    private static func activationName(_ state: WCSessionActivationState) -> String {
        switch state {
        case .notActivated: "notActivated"
        case .inactive: "inactive"
        case .activated: "activated"
        @unknown default: "notActivated"
        }
    }

    /// The shared preamble for the background channels: WC support, an
    /// ACTIVATED session (both APIs require it — unlike send, NOT
    /// reachability), and a JSON object payload.
    private func validatedSession(
        _ json: String
    ) -> Result<(WCSession, [String: Any]), SendError> {
        guard WCSession.isSupported() else {
            return .failure(
                SendError(
                    code: .unavailable, message: "WatchConnectivity is not supported"))
        }
        let session = WCSession.default
        guard session.activationState == .activated else {
            return .failure(
                SendError(code: .unavailable, message: "the session is not activated"))
        }
        guard let data = json.data(using: .utf8),
            let object = (try? JSONSerialization.jsonObject(with: data))
                as? [String: Any]
        else {
            return .failure(
                SendError(
                    code: .invalidRequest, message: "payload is not a JSON object"))
        }
        return .success((session, object))
    }

    /// Maps a WCError to a generic invoke error code (the closed channel enum);
    /// the specific WCError reason stays in the message.
    private static func invokeCode(for error: Error) -> InvokeErrorCode {
        switch (error as? WCError)?.code {
        case .notReachable, .sessionNotActivated, .sessionInactive:
            .unavailable
        case .payloadTooLarge, .payloadUnsupportedTypes:
            .invalidRequest
        default:
            .internal
        }
    }

    /// Maps a `WCError` to its case NAME, so JS can branch on
    /// `.insufficientSpace` / `.payloadTooLarge` without parsing a localized
    /// message. Only the codes a FILE transfer can actually produce are named;
    /// anything else reports nil and the message carries the detail.
    private static func errorName(for error: Error) -> String? {
        switch (error as? WCError)?.code {
        case .fileAccessDenied: "fileAccessDenied"
        case .insufficientSpace: "insufficientSpace"
        case .transferTimedOut: "transferTimedOut"
        case .deliveryFailed: "deliveryFailed"
        case .invalidParameter: "invalidParameter"
        case .payloadTooLarge: "payloadTooLarge"
        case .payloadUnsupportedTypes: "payloadUnsupportedTypes"
        case .companionAppNotInstalled: "companionAppNotInstalled"
        case .deviceNotPaired: "deviceNotPaired"
        case .notReachable: "notReachable"
        case .sessionNotActivated: "sessionNotActivated"
        case .sessionInactive: "sessionInactive"
        default: nil
        }
    }

    private func deliver(_ event: String, _ message: [String: Any]) {
        // WCSession delegate callbacks arrive off the main queue; hop to main
        // for onPush. The payload is plain JSON and the handler runs only on
        // main, so transferring them is safe — under Swift 6 strict concurrency
        // nonisolated(unsafe) is needed to capture these non-Sendable values
        // into the @Sendable closure without sending `self`.
        nonisolated(unsafe) let handler = onPush
        nonisolated(unsafe) let payload = message
        DispatchQueue.main.async { handler?(event, payload) }
    }

    func session(
        _: WCSession, didReceiveMessage message: [String: Any]
    ) {
        deliver("watchConnectivity", message)
    }

    func session(
        _: WCSession, didReceiveApplicationContext context: [String: Any]
    ) {
        deliver("watchConnectivity.applicationContext", context)
    }

    func session(
        _: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]
    ) {
        deliver("watchConnectivity.userInfo", userInfo)
    }

    /// An inbound file. THE ORDERING IS THE WHOLE POINT and it is the opposite
    /// of every other delegate method here: Apple states the system "places
    /// downloaded files inside a temporary directory", that "you must move it
    /// synchronously", and that "if you don't move the file, the system deletes
    /// it after this method returns". So the move happens HERE, inline, on the
    /// background thread WatchConnectivity calls this on — BEFORE `deliver`'s
    /// hop to main. Hopping first and moving there loses every received file.
    func session(_: WCSession, didReceive file: WCSessionFile) {
        let name = file.fileURL.lastPathComponent
        guard let inbox else {
            report(
                "connectivity.inboxUnavailable",
                "received \(name) but Application Support could not be located, "
                    + "so the file was dropped")
            return
        }
        let receivedAtMs = Int(Date().timeIntervalSince1970 * 1000)
        let sequence = nextReceiveSequence
        nextReceiveSequence += 1
        let landed: URL
        do {
            landed = try inbox.adopt(
                file.fileURL, receivedAtMs: receivedAtMs, sequence: sequence,
                name: name)
        } catch {
            report(
                "connectivity.receiveFailed",
                "could not move received file \(name) into the inbox: "
                    + error.localizedDescription)
            return
        }
        // Bound the inbox AFTER the file is safe, never before: a prune that
        // threw would otherwise take the delivery down with it.
        inbox.prune()
        let attributes = try? FileManager.default.attributesOfItem(
            atPath: landed.path)
        deliver(
            "watchConnectivity.file",
            [
                // A `file://` URL, not a bare path: this is what JS reads with
                // `fetch(path)`, and FetchPlan requires a scheme.
                "path": landed.absoluteString,
                "name": name,
                "size": (attributes?[.size] as? Int) ?? 0,
                "metadata": file.metadata ?? [:],
                "receivedAt": receivedAtMs,
            ])
    }

    /// Terminal state of an OUTBOUND transfer. Called on a background thread,
    /// and possibly in a launch that never queued the transfer — in which case
    /// no id was minted for it and `id` is omitted (JS reports `null`).
    func session(
        _: WCSession, didFinish fileTransfer: WCSessionFileTransfer,
        error: (any Error)?
    ) {
        transferLock.lock()
        let id = idsByTransfer.removeValue(forKey: ObjectIdentifier(fileTransfer))
        if let id { transfersById.removeValue(forKey: id) }
        transferLock.unlock()
        var payload: [String: Any] = [
            "state": error == nil ? "finished" : "failed"
        ]
        if let id { payload["id"] = id }
        if let error {
            payload["error"] = error.localizedDescription
            if let code = Self.errorName(for: error) { payload["code"] = code }
        }
        deliver("watchConnectivity.fileTransfer", payload)
    }

    /// The THREE state callbacks watchOS delivers, all folded into one
    /// `watchConnectivity.state` push. There is deliberately no
    /// `sessionWatchStateDidChange` here: Apple lists no watchOS availability
    /// for it (iOS/iPadOS/Mac Catalyst only), so these three are the complete
    /// delta surface on this side.
    func session(
        _: WCSession,
        activationDidCompleteWith _: WCSessionActivationState,
        error _: Error?
    ) {
        deliver("watchConnectivity.state", connectivityState())
    }

    func sessionReachabilityDidChange(_: WCSession) {
        deliver("watchConnectivity.state", connectivityState())
    }

    func sessionCompanionAppInstalledDidChange(_: WCSession) {
        deliver("watchConnectivity.state", connectivityState())
    }

    /// Hops an unattributable failure to main for the model's diagnostic ring.
    /// Same `nonisolated(unsafe)` shape as `deliver`, for the same reason.
    private func report(_ code: String, _ details: String) {
        nonisolated(unsafe) let handler = onError
        DispatchQueue.main.async { handler?(code, details) }
    }
}
#endif
