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

    /// The raw payload JSON last saved, undecoded. nil before the first
    /// publication. Both publish sites read this BEFORE overwriting it, so
    /// `WidgetPublishGate` can decide whether the new payload is worth a
    /// `WidgetCenter` reload; everything else wants `loadPublishedWidgets`.
    public func publishedWidgetsJSON() -> String? {
        defaults?.string(forKey: Self.payloadKey)
    }

    /// Decode the React-published widget timelines the app last saved (the
    /// inverse of `save`). The widget extension's TimelineProviders read this to
    /// render without a process running. nil if nothing's been published yet or
    /// the stored JSON doesn't decode. Foundation+Core only, so it's
    /// unit-tested on Linux alongside `save`.
    public func loadPublishedWidgets() -> PublishedWidgets? {
        guard let json = publishedWidgetsJSON() else {
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

    /// OTA same-version replay mark (scheme v3): the highest signed publish
    /// `sequence` this device has ACCEPTED AT STAGE — not the running bundle's,
    /// and never raised at boot. Same App Group as the version mark and the db
    /// so all three share fate on uninstall. 0 when unset (fresh install), so
    /// the first validly signed bundle sets it.
    public static let otaSequenceHighWaterKey = "react.ota.sequenceHighWater"

    public func otaSequenceHighWater() -> Int {
        defaults?.integer(forKey: Self.otaSequenceHighWaterKey) ?? 0
    }

    public func setOTASequenceHighWater(_ sequence: Int) {
        defaults?.set(sequence, forKey: Self.otaSequenceHighWaterKey)
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

    /// Widget → app: the last JS failure the widget extension hit (a throwing
    /// intent handler, a timeline render that threw). The extension has no
    /// diagnostics ring and no push channel to the app, so without this slot
    /// its errors were logged and gone — the app, and any sink an operator
    /// wired into it, never learned that the complication had failed. One
    /// slot, last write wins: a plain `set` is atomic per key, whereas an
    /// append (a ring) would be the cross-process read-modify-write ARCH-05
    /// exists to avoid. The app reads AND clears it at boot (`take`), so each
    /// failure is reported once; a write that lands between that read and the
    /// clear is lost, which is accepted for a last-error slot.
    public static let widgetDiagnosticKey = "react.widget.lastDiagnostic"

    public func saveWidgetDiagnostic(_ diagnostic: Diagnostic) {
        guard let data = try? JSONEncoder().encode(diagnostic),
            let json = String(data: data, encoding: .utf8)
        else { return }
        defaults?.set(json, forKey: Self.widgetDiagnosticKey)
    }

    /// The stored diagnostic, removed from the slot on the way out. nil when
    /// nothing was stored or the stored JSON doesn't decode.
    public func takeWidgetDiagnostic() -> Diagnostic? {
        guard let json = defaults?.string(forKey: Self.widgetDiagnosticKey) else {
            return nil
        }
        defaults?.removeObject(forKey: Self.widgetDiagnosticKey)
        return try? JSONDecoder().decode(Diagnostic.self, from: Data(json.utf8))
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
