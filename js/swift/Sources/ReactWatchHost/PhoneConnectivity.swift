// watchOS-only host (WatchKit/UIKit/HealthKit/SwiftUI). The #if compiles this
// file to an empty module off-watchOS so `swift test` runs on macOS — see Package.swift.
#if os(watchOS)
import Foundation
import WatchConnectivity

/// A sendToPhone failure, mapped to a generic invoke error `code` (SD-1) with
/// the WCError detail in `message`. Sendable so it can cross WCSession's
/// background-queue handlers back to the main actor.
struct SendError: Error, Sendable {
    let code: String
    let message: String
}

/// Bridges WatchConnectivity to the JS native-event channel. Incoming phone
/// messages are forwarded as a "watchConnectivity" native push (so they
/// commit instantly via runSync); sendToPhone goes out over WCSession.
/// NOTE: untested until built with Xcode on macOS. The paired iPhone app
/// (the Expo companion) needs its own WCSession wiring to talk back.
final class PhoneConnectivity: NSObject, WCSessionDelegate {
    /// Called on the main queue with each decoded phone message.
    var onMessage: (([String: Any]) -> Void)?

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
                        code: "UNAVAILABLE", message: "WatchConnectivity is not supported")))
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
                        code: "INVALID_REQUEST", message: "message is not a JSON object")))
            return
        }
        // sendMessage is the only API with a reply/error pair, and it needs the
        // phone reachable — pre-check so "not reachable" is a clean reject.
        guard session.isReachable else {
            completion(
                .failure(
                    SendError(
                        code: "UNAVAILABLE", message: "the iPhone is not reachable")))
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

    /// Maps a WCError to a generic invoke error code (the closed channel enum);
    /// the specific WCError reason stays in the message.
    private static func invokeCode(for error: Error) -> String {
        switch (error as? WCError)?.code {
        case .notReachable, .sessionNotActivated, .sessionInactive:
            "UNAVAILABLE"
        case .payloadTooLarge, .payloadUnsupportedTypes:
            "INVALID_REQUEST"
        default:
            "INTERNAL"
        }
    }

    private func deliver(_ message: [String: Any]) {
        // WCSession delegate callbacks arrive off the main queue; hop to main
        // for onMessage. The payload is plain JSON and the handler runs only on
        // main, so transferring them is safe — under Swift 6 strict concurrency
        // nonisolated(unsafe) is needed to capture these non-Sendable values
        // into the @Sendable closure without sending `self`.
        nonisolated(unsafe) let handler = onMessage
        nonisolated(unsafe) let payload = message
        DispatchQueue.main.async { handler?(payload) }
    }

    func session(
        _: WCSession, didReceiveMessage message: [String: Any]
    ) {
        deliver(message)
    }

    func session(
        _: WCSession, didReceiveApplicationContext context: [String: Any]
    ) {
        deliver(context)
    }

    func session(
        _: WCSession,
        activationDidCompleteWith _: WCSessionActivationState,
        error _: Error?
    ) {}
}
#endif
