import Foundation

/// The closed set of codes an invoke rejection may carry (SD-1) — the Swift
/// half of `InvokeErrorCode` in js/src/invoke.ts.
///
/// An enum, not a `String`, because the set was closed by TYPE ONLY and never
/// at runtime: JS's `settle()` cast whatever arrived through
/// `as InvokeErrorCode`, so an ad-hoc native code became a value the type
/// system endorsed and no `if (e.code === …)` could ever match. That shipped
/// twice — `playAudio`'s `"AUDIO_FAILED"` (caught by the 2026-07-02 review
/// cycle) and then `getCurrentLocation`'s `"LOCATION_UNAVAILABLE"` (caught by
/// the next one). Spelling the set as an enum makes the third instance a
/// COMPILE error at the reject site instead of a review finding.
public enum InvokeErrorCode: String, Sendable, CaseIterable {
    /// No handler is routed for this method name.
    case unknownMethod = "UNKNOWN_METHOD"
    /// The USER declined — a permission sheet, or a restricted setting.
    case permissionDenied = "PERMISSION_DENIED"
    /// ARCH-07: the binary backs the method's feature but the app's HostPolicy
    /// doesn't authorize it — fixable only by an app configuration change.
    case policyDenied = "POLICY_DENIED"
    /// The binary/runtime/hardware can't serve the call — no backing in this
    /// target, no connection, no fix available.
    case unavailable = "UNAVAILABLE"
    /// The payload is missing, malformed, or superseded.
    case invalidRequest = "INVALID_REQUEST"
    /// A native error with no better classification.
    case `internal` = "INTERNAL"
}

/// The one way to build an invoke reject payload (`{code, message}`) — via
/// JSONSerialization, so ANY message content escapes correctly. The BLE bridge
/// used to hand-build this escaping only double quotes: a backslash or newline
/// in a peripheral-supplied string produced invalid errorJson, and JS's
/// JSON.parse error replaced the typed rejection. Pure Foundation → Linux-tested.
public enum InvokeErrorJSON {
    public static func make(code: InvokeErrorCode, message: String) -> String {
        (try? JSONSerialization.data(
            withJSONObject: ["code": code.rawValue, "message": message]))
            .flatMap { String(data: $0, encoding: .utf8) }
            // JSONSerialization can't fail on [String: String]; the fallback
            // is compile-time-safe JSON just in case.
            ?? #"{"code":"INTERNAL","message":"error encoding failed"}"#
    }
}
