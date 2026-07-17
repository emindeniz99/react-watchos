import Foundation

/// Pure helpers for the remote-push (APNs) bridge: the device-token hex
/// encoding and the userInfo sanitization the host applies before a payload
/// crosses the JSON bridge into JS. Foundation-only, so both are unit-tested
/// on Linux — the watchOS host just forwards WatchKit delegate values here.
public enum RemotePushWire {
    /// APNs device token -> the lowercase hex string a push server expects.
    /// Tokens are variable length (never assume 32 bytes) and can change
    /// between launches, so apps re-register every launch and send the fresh
    /// value; this is just the canonical encoding of whatever arrived.
    public static func hexToken(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    /// Reduces a remote notification's `userInfo` (`[AnyHashable: Any]`) to a
    /// `[String: Any]` JSONSerialization can encode. Rule: non-String keys
    /// are stringified (`String(describing:)`); container values (dictionary/
    /// array) are reduced recursively; every other value survives iff
    /// JSONSerialization accepts it (String/NSNumber incl. Bool/NSNull) and
    /// is DROPPED otherwise (Data, Date, custom objects, non-finite numbers).
    /// Dropping beats stringifying: an APNs payload is JSON by origin, so an
    /// unencodable value is host-side noise — `String(describing:)` junk like
    /// "<CFData 0x…>" must not leak into app logic as a real value.
    public static func sanitize(_ userInfo: [AnyHashable: Any]) -> [String: Any] {
        var result: [String: Any] = [:]
        for (key, value) in userInfo {
            let name = key as? String ?? String(describing: key)
            if let sanitized = sanitizeValue(value) {
                result[name] = sanitized
            }
        }
        return result
    }

    private static func sanitizeValue(_ value: Any) -> Any? {
        if let dictionary = value as? [AnyHashable: Any] {
            return sanitize(dictionary)
        }
        if let array = value as? [Any] {
            return array.compactMap(sanitizeValue)
        }
        // Leaf: keep exactly what JSONSerialization can encode (wrapped in an
        // array because fragments aren't valid top-level objects to it).
        return JSONSerialization.isValidJSONObject([value]) ? value : nil
    }
}
