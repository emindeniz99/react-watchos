import Foundation

/// App Group storage shared with the widget extension (targets/widget).
/// The app writes React-rendered timelines here; the extension reads them
/// in its TimelineProvider. The group id must match both targets'
/// entitlements and the copy in targets/widget/ReactWidgets.swift.
enum SharedWidgetStore {
    static let appGroupId = "group.com.emindeniz99.reactwatch"
    static let payloadKey = "react.widgets.payload"

    static func save(_ payloadJson: String) {
        UserDefaults(suiteName: appGroupId)?
            .set(payloadJson, forKey: payloadKey)
    }
}
