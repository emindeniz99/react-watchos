import Foundation

/// The one way to build an invoke reject payload (`{code, message}`) — via
/// JSONSerialization, so ANY message content escapes correctly. The BLE bridge
/// used to hand-build this escaping only double quotes: a backslash or newline
/// in a peripheral-supplied string produced invalid errorJson, and JS's
/// JSON.parse error replaced the typed rejection. Pure Foundation → Linux-tested.
public enum InvokeErrorJSON {
    public static func make(code: String, message: String) -> String {
        (try? JSONSerialization.data(
            withJSONObject: ["code": code, "message": message]))
            .flatMap { String(data: $0, encoding: .utf8) }
            // JSONSerialization can't fail on [String: String]; the fallback
            // is compile-time-safe JSON just in case.
            ?? #"{"code":"INTERNAL","message":"error encoding failed"}"#
    }
}
