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
        case .success(let (session, object)):
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
        case .success(let (session, object)):
            session.transferUserInfo(object)
            return nil
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

    func session(
        _: WCSession,
        activationDidCompleteWith _: WCSessionActivationState,
        error _: Error?
    ) {}
}
#endif
