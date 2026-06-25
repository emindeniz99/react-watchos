import Foundation

/// App Group storage shared with the widget extension (targets/widget). The
/// app writes React-rendered timelines here; the extension reads them in its
/// TimelineProvider. Construct with the consumer's group id (nil disables
/// sharing) — no global mutable state. Foundation only, so it builds and is
/// type/concurrency-checked on Linux.
public struct SharedWidgetStore: Sendable {
    public static let payloadKey = "react.widgets.payload"
    /// Namespace for the JS Storage API (js/src/storage.ts).
    public static let storagePrefix = "react.storage."

    public let appGroupId: String?

    public init(appGroupId: String?) {
        self.appGroupId = appGroupId
    }

    private var defaults: UserDefaults? {
        guard let appGroupId else { return nil }
        return UserDefaults(suiteName: appGroupId)
    }

    public func save(_ payloadJson: String) {
        defaults?.set(payloadJson, forKey: Self.payloadKey)
    }

    public func getItem(_ key: String) -> String? {
        defaults?.string(forKey: Self.storagePrefix + key)
    }

    public func setItem(_ key: String, _ value: String) {
        defaults?.set(value, forKey: Self.storagePrefix + key)
    }

    /// OTA anti-rollback high-water mark (CR-17). Kept in the *same* App Group as
    /// Storage so the version record and the db share fate: if the db survives,
    /// so does the mark; if one is wiped (uninstall), so is the other — the db
    /// can never be "ahead" of a reset mark. `integer(forKey:)` is 0 when unset.
    public static let otaHighWaterKey = "react.ota.highWater"

    public func otaHighWater() -> Int {
        defaults?.integer(forKey: Self.otaHighWaterKey) ?? 0
    }

    public func setOTAHighWater(_ version: Int) {
        defaults?.set(version, forKey: Self.otaHighWaterKey)
    }

    /// OTA crash-loop guard (ARCH-04): boots that ran the OTA bundle but never
    /// reached a healthy first commit. Incremented before evaluating the bundle
    /// and reset to 0 on the first commit (host) — so a *native* crash on boot
    /// (which kills the process before the JS-throw fallback can run) leaves the
    /// count standing, and enough such boots roll the bundle back. Same App Group
    /// as the bundle, so they share fate on uninstall. 0 when unset.
    public static let otaBootAttemptsKey = "react.ota.bootAttempts"

    public func otaBootAttempts() -> Int {
        defaults?.integer(forKey: Self.otaBootAttemptsKey) ?? 0
    }

    public func setOTABootAttempts(_ count: Int) {
        defaults?.set(count, forKey: Self.otaBootAttemptsKey)
    }
}
