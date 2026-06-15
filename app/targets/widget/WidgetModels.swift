import Foundation

// The wire structs (JSONValue, RNNode, Published*) are generated from
// js/codegen/schema.mjs into Generated/WireModel.swift. Only the App Group
// storage helper lives here.

enum WidgetStore {
    static let appGroupId = "group.com.emindeniz99.reactwatch"
    static let payloadKey = "react.widgets.payload"
    /// Namespace for the JS Storage API (js/src/storage.ts); must match
    /// SharedWidgetStore.storagePrefix in the watch target.
    static let storagePrefix = "react.storage."

    static func load() -> PublishedWidgets? {
        guard let json = UserDefaults(suiteName: appGroupId)?
            .string(forKey: payloadKey) else { return nil }
        return try? JSONDecoder().decode(
            PublishedWidgets.self, from: Data(json.utf8))
    }
}
