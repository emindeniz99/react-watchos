import Foundation

/// App Group storage shared with the widget extension (targets/widget).
/// The app writes React-rendered timelines here; the extension reads them
/// in its TimelineProvider. The group id must match both targets'
/// entitlements and the copy in targets/widget/ReactWidgets.swift.
enum SharedWidgetStore {
    static let appGroupId = "group.com.emindeniz99.reactwatch"
    static let payloadKey = "react.widgets.payload"
    /// Namespace for the JS Storage API (js/src/storage.ts).
    static let storagePrefix = "react.storage."

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupId) }

    static func save(_ payloadJson: String) {
        defaults?.set(payloadJson, forKey: payloadKey)
    }

    static func getItem(_ key: String) -> String? {
        defaults?.string(forKey: storagePrefix + key)
    }

    static func setItem(_ key: String, _ value: String) {
        defaults?.set(value, forKey: storagePrefix + key)
    }
}
