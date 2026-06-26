/// Classifies the OTA signing-key configuration into one of three states
/// (CX-003), so a *misconfigured* key can't silently degrade to fail-open.
///
/// The trap CX-003 fixes: a developer who sets `OTAConfig.signerPublicKeys` has
/// clearly opted into enforcing signatures, but if every configured key fails to
/// decode (a base64 typo), a naive "decode → drop invalid → is the map empty?"
/// collapses that into the SAME state as "no keys configured" → fail-open, so the
/// watch quietly accepts unsigned bundles. These three states keep them distinct.
public enum OTAKeyState: Equatable, Sendable {
    /// No keys configured at all — intentional dev/fail-open mode (load unsigned
    /// with a warning).
    case disabled
    /// At least one configured key decoded — enforce signatures (a key that
    /// failed to decode is dropped + warned, but valid keys still work).
    case enforced
    /// Keys WERE configured but NONE decoded — fail closed: refuse all OTA
    /// updates loudly until the config is fixed, never fall through to fail-open.
    case misconfigured

    /// `configuredCount` = entries in `signerPublicKeys`; `validCount` = how many
    /// decoded to a usable key.
    public static func classify(configuredCount: Int, validCount: Int) -> OTAKeyState {
        if configuredCount == 0 { return .disabled }
        if validCount == 0 { return .misconfigured }
        return .enforced
    }
}
