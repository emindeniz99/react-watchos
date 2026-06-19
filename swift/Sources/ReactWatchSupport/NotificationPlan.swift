import Foundation

/// Decodes a js/src/notifications.ts request and computes its trigger time —
/// the fiddly part (absolute `at` vs relative `afterMs`, the 1s minimum
/// UNTimeIntervalNotificationTrigger requires, and detecting a past time).
/// Pure + Foundation-only, so the host just builds a UNNotificationRequest
/// from it and this math is unit-tested on Linux.
public struct NotificationPlan: Sendable, Equatable {
    public let id: String
    public let title: String
    public let body: String
    public let sound: Bool
    /// Seconds from now, clamped to the >= 1 the trigger requires.
    public let triggerSeconds: TimeInterval
    /// `at` was meaningfully in the past — the caller should warn and deliver
    /// (roughly) now rather than silently turning it into "in 1 second".
    public let scheduledInPast: Bool

    private struct Payload: Decodable {
        let id: String
        let title: String
        let body: String
        let at: Double?
        let afterMs: Double?
        let sound: Bool
    }

    public init?(json: String, now: Date = .now) {
        guard let payload = try? JSONDecoder().decode(
            Payload.self, from: Data(json.utf8)) else { return nil }
        // `at` (absolute, ms since epoch) wins over `afterMs` (relative).
        let seconds: TimeInterval
        if let at = payload.at {
            seconds = at / 1000 - now.timeIntervalSince1970
        } else {
            seconds = (payload.afterMs ?? 0) / 1000
        }
        id = payload.id
        title = payload.title
        body = payload.body
        sound = payload.sound
        scheduledInPast = seconds < -1
        triggerSeconds = max(1, seconds)
    }
}
