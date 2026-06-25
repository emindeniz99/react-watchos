import Foundation

/// Decodes the `__host.saveUpdate` payload from js/src/update.ts into the
/// bundle text, its compatibility version, and its Ed25519 signature. Pure (no
/// CryptoKit), so the parsing + the signed-message construction are unit-tested
/// off-device; the host does the actual signature check with the configured key.
///
/// Security (CR-4 / CR-17): an OTA bundle is arbitrary JS that runs with the
/// full host surface, so an unverified one is in-sandbox RCE. The signature
/// covers `signedMessage` — `"<scheme>:<version>:<js>"` — so the **version is
/// inside the signed data**: it can't be relabelled, which is what makes
/// anti-rollback trustworthy (an attacker can't pass off an old bundle as new).
/// With no key configured it's fail-open (loads with a warning) so an
/// un-updated consumer keeps working.
public struct UpdatePlan: Equatable, Sendable {
    /// Signature/format scheme tag — bumped if the signing scheme ever changes
    /// (crypto-agility), kept inside the signed bytes.
    public static let scheme = "v1"

    public let js: String
    /// Compatibility version (monotonic; bumped only on a breaking change).
    /// nil for a legacy/unsigned payload.
    public let version: Int?
    /// Raw Ed25519 signature bytes over `signedMessage` (base64 on the wire).
    public let signature: Data?

    private struct Payload: Decodable {
        let js: String
        let version: Int?
        let signature: String?
    }

    public init(js: String, version: Int?, signature: Data?) {
        self.js = js
        self.version = version
        self.signature = signature
    }

    /// Parses the saveUpdate payload. The signed shape is
    /// `{"js":"…","version":N,"signature":"<base64>"}`; a payload that isn't
    /// that object is treated as a bare (legacy/unsigned) bundle so older
    /// callers still work — they then take the fail-open path in the host.
    public init(payload: String) {
        guard let data = payload.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(Payload.self, from: data)
        else {
            js = payload
            version = nil
            signature = nil
            return
        }
        js = decoded.js
        version = decoded.version
        signature = decoded.signature.flatMap { Data(base64Encoded: $0) }
    }

    /// The exact bytes the signature must cover: scheme + version + bundle, so
    /// the version is bound to the bundle and can't be tampered. nil when the
    /// payload carries no version (nothing to verify).
    public func signedMessage() -> Data? {
        guard let version else { return nil }
        return Data("\(Self.scheme):\(version):\(js)".utf8)
    }
}
