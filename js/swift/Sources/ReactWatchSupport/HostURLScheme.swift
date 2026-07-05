import Foundation

/// The app's custom URL scheme, surfaced to JS as `globalThis.__urlScheme`.
///
/// One source of truth: the config plugin writes the scheme into the APP's
/// Info.plist (`CFBundleURLSchemes`, defaulting to the app's bundle id). Only
/// the app process can read it there — a widget extension's own `Bundle.main`
/// has no `CFBundleURLTypes`. So the app reads it here and publishes it into
/// the shared App Group (`SharedWidgetStore.saveURLScheme`); the widget process
/// reads that back. Both then inject the SAME value into JS, and
/// `navigation.tsx` (`getURLScheme`/`deepLinkURL`) builds and parses deep links
/// from it — instead of a hardcoded `reactwatch://` literal repeated across the
/// app, the widget, and the Info.plist.
///
/// Foundation only, so it builds and is unit-tested on Linux.
public enum HostURLScheme {
    /// The first non-empty `CFBundleURLSchemes` entry in a `CFBundleURLTypes`
    /// array (the Info.plist shape). Pure, so the parse is unit-tested without a
    /// real `Bundle`.
    public static func firstScheme(in types: [[String: Any]]?) -> String? {
        guard let types else { return nil }
        for type in types {
            if let schemes = type["CFBundleURLSchemes"] as? [String],
                let first = schemes.first, !first.isEmpty
            {
                return first
            }
        }
        return nil
    }

    /// The app's first registered `CFBundleURLScheme` (`Bundle.main`), or nil
    /// when none is registered (a host embedded without the config plugin).
    public static func registered(in bundle: Bundle = .main) -> String? {
        firstScheme(
            in: bundle.object(forInfoDictionaryKey: "CFBundleURLTypes")
                as? [[String: Any]])
    }

    /// The `globalThis.__urlScheme='...';` boot injection, or "" when the scheme
    /// is unknown (JS keeps its own "reactwatch" fallback). Escaped so a crafted
    /// Info.plist scheme can't break out of the string literal — a real scheme
    /// (`[A-Za-z][A-Za-z0-9+.-]*`) carries no quote/backslash, but defense in
    /// depth is cheap.
    public static func inject(_ scheme: String?) -> String {
        guard let scheme, !scheme.isEmpty else { return "" }
        let safe =
            scheme
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        return "globalThis.__urlScheme='\(safe)';"
    }
}
