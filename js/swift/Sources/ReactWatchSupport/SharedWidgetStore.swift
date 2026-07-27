import Foundation
import ReactWatchCore

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

    /// Resolved once at init: the computed-property version constructed a
    /// UserDefaults per operation, and this store sits on the Storage bridge
    /// hot path (every JS getItem/setItem) plus the OTA counters. UserDefaults
    /// is documented thread-safe; `nonisolated(unsafe)` keeps the struct's
    /// Sendable conformance (the class type itself isn't marked Sendable).
    nonisolated(unsafe) private let defaults: UserDefaults?

    public init(appGroupId: String?) {
        self.appGroupId = appGroupId
        defaults = appGroupId.flatMap { UserDefaults(suiteName: $0) }
    }

    public func save(_ payloadJson: String) {
        defaults?.set(payloadJson, forKey: Self.payloadKey)
    }

    /// Decode the React-published widget timelines the app last saved (the
    /// inverse of `save`). The widget extension's TimelineProviders read this to
    /// render without a process running. nil if nothing's been published yet or
    /// the stored JSON doesn't decode. Foundation+Core only, so it's
    /// unit-tested on Linux alongside `save`.
    public func loadPublishedWidgets() -> PublishedWidgets? {
        guard let json = defaults?.string(forKey: Self.payloadKey) else {
            return nil
        }
        return try? JSONDecoder().decode(
            PublishedWidgets.self, from: Data(json.utf8))
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

    /// The JS bundle content id the widget extension last booted (ARCH-06).
    ///
    /// A TimelineProvider callback has to decide whether a stored payload was
    /// produced by a FOREIGN release, and it must decide without booting an
    /// engine (the boot is the cost the decision exists to avoid). Its own
    /// release id is only known inside `WidgetIntentRuntime`, after bundle
    /// selection — so the runtime records it here on every boot and the
    /// provider reads it back for the price of a UserDefaults lookup.
    ///
    /// Same app→widget publish/read shape as `urlScheme`, one process over. nil
    /// before this extension has ever booted a bundle, which reads as "reader
    /// release unknown" and — like an unknown producer — never rejects.
    public static let widgetReleaseIdKey = "react.widget.releaseId"

    public func saveWidgetReleaseId(_ releaseId: String?) {
        guard let releaseId, !releaseId.isEmpty else { return }
        defaults?.set(releaseId, forKey: Self.widgetReleaseIdKey)
    }

    public func widgetReleaseId() -> String? {
        defaults?.string(forKey: Self.widgetReleaseIdKey)
    }

    /// App → widget: the app's custom URL scheme (see `HostURLScheme`). Only the
    /// app process can read `CFBundleURLSchemes` from its Info.plist; it
    /// publishes the value here so the widget extension — whose own Bundle.main
    /// has no URL types — builds deep links (`deepLinkURL`) from the same scheme
    /// the app parses. No-op with no App Group or an empty scheme.
    public static let urlSchemeKey = "react.urlScheme"

    public func saveURLScheme(_ scheme: String?) {
        guard let scheme, !scheme.isEmpty else { return }
        defaults?.set(scheme, forKey: Self.urlSchemeKey)
    }

    /// The scheme the app published, or nil before the app has run once (the
    /// widget then falls back to the JS default).
    public func urlScheme() -> String? {
        defaults?.string(forKey: Self.urlSchemeKey)
    }
}
