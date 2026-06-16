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
                  as? [String: Any] else { return }
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil, errorHandler: nil)
        } else {
            // Not reachable: queue as application context (latest-wins).
            try? session.updateApplicationContext(message)
        }
    }

    private func deliver(_ message: [String: Any]) {
        DispatchQueue.main.async { self.onMessage?(message) }
    }

    func session(
        _ session: WCSession, didReceiveMessage message: [String: Any]
    ) {
        deliver(message)
    }

    func session(
        _ session: WCSession, didReceiveApplicationContext context: [String: Any]
    ) {
        deliver(context)
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith state: WCSessionActivationState,
        error: Error?
    ) {}
}
