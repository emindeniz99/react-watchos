// watchOS-only host (WatchKit/UIKit/HealthKit/SwiftUI). The #if compiles this
// file to an empty module off-watchOS so `swift test` runs on macOS — see Package.swift.
#if os(watchOS)
import Foundation
import WatchConnectivity

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

    func send(_ json: String) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard let data = json.data(using: .utf8),
            let message = (try? JSONSerialization.jsonObject(with: data))
                as? [String: Any]
        else { return }
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil, errorHandler: nil)
        } else {
            // Not reachable: queue as application context (latest-wins).
            try? session.updateApplicationContext(message)
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
