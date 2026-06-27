import Foundation

/// Names (and container lookup) of the OTA files in the App Group, shared by the
/// app — which writes them — and the widget extension, which reads the
/// known-good one to render the same bundle the app last booted healthily. One
/// source of truth so the two processes can't drift on a path (SD-4). Pure
/// Foundation, so it's the shared constant for both targets.
public enum OTAFiles {
    /// The active OTA record + its pinned bytecode cache (what the app boots,
    /// subject to its anti-rollback / crash-loop gates).
    public static let activeRecord = "ota-bundle.json"
    public static let activeBytecode = "ota-bundle.qbc"
    /// The last OTA record that reached a healthy commit (ARCH-04). The widget
    /// renders THIS — never the unvetted active record — so a bundle that would
    /// brick the extension can't reach the complication on every refresh.
    public static let knownGoodRecord = "ota-bundle.good.json"
    public static let knownGoodBytecode = "ota-bundle.good.qbc"

    /// The App Group container file for `name`, or nil when the group is
    /// unavailable (missing entitlement / nil id).
    public static func url(appGroupId: String, _ name: String) -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
            .appendingPathComponent(name)
    }
}
