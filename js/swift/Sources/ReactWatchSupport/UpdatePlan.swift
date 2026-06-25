import Foundation

/// Decodes the `__host.saveUpdate` payload from js/src/update.ts into the
/// bundle text and its optional Ed25519 signature. Pure (no CryptoKit), so the
/// payload parsing is unit-tested off-device; the host does the actual
/// signature check with the configured public key.
///
/// Security (CR-4): an OTA bundle is arbitrary JS that runs with the full host
/// surface, so an unsigned bundle from a compromised origin is in-sandbox RCE.
/// When the app configures a public key the host verifies `signature` over the
/// bundle bytes before persisting/evaluating; with no key it's fail-open (loads
/// with a loud warning) so an un-updated consumer keeps working.
public struct UpdatePlan: Equatable, Sendable {
    public let js: String
    /// Raw Ed25519 signature bytes over the UTF-8 bundle, if the bundle was
    /// signed (base64 in the wire payload).
    public let signature: Data?

    private struct Payload: Decodable {
        let js: String
        let signature: String?
    }

    public init(js: String, signature: Data?) {
        self.js = js
        self.signature = signature
    }

    /// Parses the saveUpdate payload. The signed shape is
    /// `{"js":"...","signature":"<base64>"}`; a payload that isn't that object
    /// is treated as a bare (legacy/unsigned) bundle so older callers still
    /// work — they then take the fail-open path in the host.
    public init(payload: String) {
        guard let data = payload.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(Payload.self, from: data)
        else {
            js = payload
            signature = nil
            return
        }
        js = decoded.js
        signature = decoded.signature.flatMap { Data(base64Encoded: $0) }
    }
}
