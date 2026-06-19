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
}
