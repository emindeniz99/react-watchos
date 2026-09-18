import Foundation

/// Decodes the `__host.saveUpdate` payload from js/src/update.ts into the
/// bundle text, its compatibility version, and its Ed25519 signature. Pure (no
/// CryptoKit), so the parsing + the signed-message construction are unit-tested
/// off-device; the host does the actual signature check with the configured key.
///
/// Security (CR-4 / CR-17): an OTA bundle is arbitrary JS that runs with the
/// full host surface, so an unverified one is in-sandbox RCE. The signature
/// covers `signedMessage` —
/// `"<scheme>:<keyId>:<version>:<sequence>:<expiresAt>:<js>"` — so the
/// **key id, version and publish sequence are inside the signed data**: none
/// can be relabelled. Binding the version makes anti-rollback trustworthy (an
/// attacker can't pass off an old bundle as new); binding the `sequence`
/// closes the same-`version` replay (the sequencer refuses a sequence below
/// the highest it has accepted); binding the `keyId` (CX-007)
/// is what makes key rotation safe — the signer commits to *which* key signed
/// *this* bundle, so a `keyId` can't be swapped to steer the host to a
/// different verification key (the JWT `kid`-confusion failure mode). The host
/// keeps a small baked-in `keyId -> publicKey` map; an unknown `keyId` fails
/// closed. With no key configured it's fail-open (loads with a warning) so an
/// un-updated consumer keeps working.
public struct UpdatePlan: Equatable, Sendable {
    /// Signature/format scheme tag — bumped if the signing scheme ever changes
    /// (crypto-agility), kept inside the signed bytes. v2 bound `expiresAt`
    /// (epoch seconds, 0 = never) into the signature — the revocation lever:
    /// an old signed bundle stops verifying after it lapses. v3 adds the
    /// publish `sequence` between version and expiresAt: at the same
    /// compatibility `version` nothing in the v2 bytes was ordered, so a
    /// re-served earlier signed build installed as a fresh release. Each
    /// binary accepts exactly one scheme; a v2 signature never verifies over
    /// a v3 message (prefix and slot count both differ).
    public static let scheme = "v3"

    /// A `keyId` must be colon-free (the signed message is `:`-delimited and
    /// `js` is the only free-form field) so the concatenation stays injective —
    /// `kid="a:1",version=0` must not collide with `kid="a",version="1:0"`.
    /// Enforced on BOTH the signer and the verifier (per the rotation design
    /// review): the host validates the parsed `keyId` before trusting the
    /// split, rather than relying on a well-behaved signer. `version`,
    /// `sequence` and `expiresAt` are `Int` (colon-impossible) so only
    /// `keyId` needs guarding.
    public static func isValidKeyId(_ keyId: String) -> Bool {
        !keyId.isEmpty && keyId.count <= 64
            && keyId.allSatisfy {
                $0.isASCII
                    && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-")
            }
    }

    public let js: String
    /// Opaque signing-key id (CX-007). Selects the host's trusted public key and
    /// is bound into the signed bytes. nil for a legacy/unsigned payload.
    public let keyId: String?
    /// Compatibility version (monotonic; bumped only on a breaking change).
    /// nil for a legacy/unsigned payload.
    public let version: Int?
    /// Raw Ed25519 signature bytes over `signedMessage` (base64 on the wire).
    public let signature: Data?
    /// Epoch seconds after which the signature stops verifying (bound into
    /// the signed bytes). nil/0 = never expires.
    public let expiresAt: Int?
    /// Publisher-monotonic publish ordinal, bound into the signed bytes: orders
    /// releases at the same `version` so a re-served earlier build is refused
    /// at save. nil = no sequence (a pre-v3 payload) — nothing verifiable.
    /// `Int` is 32-bit on arm64_32, so the signer caps it at Int32.max; a
    /// larger value would fail the whole decode on pre-S9 watches.
    public let sequence: Int?
    /// Capability features the bundle requires (ARCH-01). The host refuses to
    /// apply a bundle whose features it doesn't provide (CapabilityGate); empty
    /// = no requirement declared.
    public let requiredFeatures: [String]
    /// Minimum host bridge-protocol the bundle needs (ARCH-01); 0 = none.
    public let minBridgeProtocol: Int

    private struct Payload: Decodable {
        let js: String
        let keyId: String?
        let version: Int?
        let signature: String?
        let requiredFeatures: [String]?
        let minBridgeProtocol: Int?
        let expiresAt: Int?
        let sequence: Int?
    }

    public init(
        js: String, keyId: String? = nil, version: Int?, signature: Data?,
        requiredFeatures: [String] = [], minBridgeProtocol: Int = 0,
        expiresAt: Int? = nil, sequence: Int? = nil
    ) {
        self.js = js
        self.keyId = keyId
        self.version = version
        self.signature = signature
        self.requiredFeatures = requiredFeatures
        self.minBridgeProtocol = minBridgeProtocol
        self.expiresAt = expiresAt
        self.sequence = sequence
    }

    /// Parses the saveUpdate payload. The signed shape is
    /// `{"js":"…","keyId":"…","version":N,"signature":"<base64>","sequence":N}`;
    /// a payload that isn't that object is treated as a bare (legacy/unsigned)
    /// bundle so older callers still work — they then take the fail-open path
    /// in the host.
    public init(payload: String) {
        guard let data = payload.data(using: .utf8),
            let decoded = try? JSONDecoder().decode(Payload.self, from: data)
        else {
            js = payload
            keyId = nil
            version = nil
            signature = nil
            requiredFeatures = []
            minBridgeProtocol = 0
            expiresAt = nil
            sequence = nil
            return
        }
        js = decoded.js
        keyId = decoded.keyId
        version = decoded.version
        signature = decoded.signature.flatMap { Data(base64Encoded: $0) }
        requiredFeatures = decoded.requiredFeatures ?? []
        minBridgeProtocol = decoded.minBridgeProtocol ?? 0
        expiresAt = decoded.expiresAt
        sequence = decoded.sequence
    }

    /// The exact bytes the signature must cover: scheme + keyId + version +
    /// sequence + expiresAt + bundle, so the key id, version, publish sequence
    /// AND expiry are bound to the bundle and can't be tampered (an expiry
    /// can't be stripped off a signed bundle, a sequence can't be raised).
    /// nil unless the payload carries a `version`, a charset-valid `keyId` AND
    /// a `sequence` (nothing verifiable otherwise — a pre-v3 payload has no
    /// sequence and reads as unsigned) — the host treats nil as
    /// "missing/invalid, reject" when keys are configured. `keyId` is the
    /// single source of truth: the same value selects the key AND is bound here,
    /// so lookup-key and signed-key can't diverge. `expiresAt` is canonical as
    /// an integer (0 = never), colon-impossible like `version` and `sequence`.
    public func signedMessage() -> Data? {
        guard let version, let keyId, let sequence, Self.isValidKeyId(keyId) else {
            return nil
        }
        return Data(
            "\(Self.scheme):\(keyId):\(version):\(sequence):\(expiresAt ?? 0):\(js)".utf8)
    }
}
