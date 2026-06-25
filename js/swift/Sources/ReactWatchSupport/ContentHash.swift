import Foundation

/// Deterministic content hash used to pair an OTA bundle's source with the
/// bytecode compiled from it (OP-1). NOT cryptographic — the Ed25519 signature
/// is the security boundary; this only detects a source/bytecode *mismatch*
/// (e.g. a crash between writing new source and overwriting the cached `.qbc`
/// leaves the previous bundle's bytecode on disk). FNV-1a, so it's stable across
/// launches (unlike Swift's per-process `Hasher`) and pure Foundation
/// (Linux-testable).
public enum ContentHash {
    public static func of(_ string: String) -> String {
        fnv1a(string.utf8)
    }

    /// Hash of raw bytes — pins an OTA record to the exact bytecode blob it was
    /// saved with (ARCH-04 atomic apply), independent of the source, so a `.qbc`
    /// left by a different bundle or a partial write is never trusted.
    public static func of(_ data: Data) -> String {
        fnv1a(data)
    }

    private static func fnv1a(_ bytes: some Sequence<UInt8>) -> String {
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325 // FNV offset basis
        for byte in bytes {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3 // FNV prime
        }
        return String(hash, radix: 16)
    }
}
