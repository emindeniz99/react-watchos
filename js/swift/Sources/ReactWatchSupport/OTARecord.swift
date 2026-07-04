import Foundation

/// The persisted active OTA bundle — source plus the metadata `load` needs, in
/// ONE file so it's written atomically (ARCH-04). A crash mid-apply can't leave
/// a new source paired with a stale version/signature: either the whole record
/// is the new one or it's untouched. The compiled bytecode lives in a separate
/// `.qbc` cache pinned by `bytecodeHash` (the hash of the blob itself, not the
/// source), so a `.qbc` from a different bundle is never trusted (OP-1).
///
/// Pure Foundation so it's the single shared record type for app + widget
/// (SD-4 direction) and unit-testable on Linux.
public struct OTARecord: Codable, Sendable, Equatable {
    public let js: String
    /// Signing key id this bundle was verified against (CX-007) — recorded for
    /// audit (which key shipped this bundle), nil when running unsigned/fail-open.
    public let keyId: String?
    /// Compatibility/anti-rollback version (nil when running unsigned/fail-open).
    public let version: Int?
    /// base64 Ed25519 over `UpdatePlan.signedMessage` — re-verified at every
    /// boot when keys are enforced (NF-35), so an actor who can write the App
    /// Group container cannot swap in unsigned code.
    public let signature: String?
    /// `ContentHash.of` the cached bytecode blob this record was saved with; load
    /// trusts the `.qbc` only when the on-disk blob hashes to this. nil = no
    /// trustworthy bytecode, parse the source.
    public var bytecodeHash: String?
    /// Epoch seconds after which the signature stops verifying (bound into the
    /// signed bytes — the revocation lever). nil/0 = never expires.
    public let expiresAt: Int?

    /// The exact bytes this record's `signature` covers — the SAME format as
    /// `UpdatePlan.signedMessage` (scheme:keyId:version:expiresAt:js), so
    /// save-time and boot-time verification can never diverge. nil when the
    /// record has no verifiable identity (unsigned/dev records).
    public func signedMessage() -> Data? {
        guard let version, let keyId, UpdatePlan.isValidKeyId(keyId) else {
            return nil
        }
        return Data(
            "\(UpdatePlan.scheme):\(keyId):\(version):\(expiresAt ?? 0):\(js)".utf8)
    }

    public init(
        js: String, keyId: String? = nil, version: Int?, signature: String?,
        bytecodeHash: String? = nil, expiresAt: Int? = nil
    ) {
        self.js = js
        self.keyId = keyId
        self.version = version
        self.signature = signature
        self.bytecodeHash = bytecodeHash
        self.expiresAt = expiresAt
    }
}
