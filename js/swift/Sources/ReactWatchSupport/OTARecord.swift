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
    /// Compatibility/anti-rollback version (nil when running unsigned/fail-open).
    public let version: Int?
    /// base64 Ed25519 over `UpdatePlan.signedMessage` — recorded for audit /
    /// future key rotation; load trusts the App Group, so it isn't re-verified.
    public let signature: String?
    /// `ContentHash.of` the cached bytecode blob this record was saved with; load
    /// trusts the `.qbc` only when the on-disk blob hashes to this. nil = no
    /// trustworthy bytecode, parse the source.
    public var bytecodeHash: String?

    public init(
        js: String, version: Int?, signature: String?, bytecodeHash: String? = nil
    ) {
        self.js = js
        self.version = version
        self.signature = signature
        self.bytecodeHash = bytecodeHash
    }
}
