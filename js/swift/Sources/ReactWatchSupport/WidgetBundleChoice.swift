import Foundation

/// Which bundle the widget extension should evaluate. The widget renders the
/// KNOWN-GOOD OTA record — the bundle the app promoted after a healthy commit —
/// and NEVER the unvetted *active* record, which the app's crash-loop guard may
/// not have cleared (a bundle that bricks the extension would brick the
/// complication on every refresh, ARCH-04). Within the known-good record it
/// prefers the pinned bytecode, but only when the on-disk blob hashes to the
/// record's `bytecodeHash` (OP-1); otherwise it parses the source. With no usable
/// known-good record it falls back to the shipped bundle.
///
/// Pure Foundation so this decision is Linux-unit-tested; `WidgetIntentRuntime`
/// is a thin watchOS shell that does the App Group file I/O and the evaluate.
public enum WidgetBundleChoice: Sendable, Equatable {
    case knownGoodBytecode
    case knownGoodSource
    case shipped

    /// - Parameters:
    ///   - knownGood: the decoded known-good OTA record, or nil if absent.
    ///   - bytecodeHashMatches: whether the on-disk `.good.qbc` blob hashes to
    ///     the record's `bytecodeHash` (false when there's no blob or it's stale).
    ///   - keyState: the widget's signing-key configuration (OTAKeyState).
    ///   - recordVerified: whether the known-good record's Ed25519 signature
    ///     re-verified against a configured key (computed by the caller; only
    ///     consulted under `.enforced`).
    ///
    /// NF-35 in the extension process: the known-good record lives in the
    /// App-Group container, which any code able to write the container may
    /// overwrite. The app re-verifies stored records at boot; the widget must too
    /// — so under `.enforced` an unverified record falls back to the shipped
    /// bundle (inside the signed app bundle, where no untrusted writer exists).
    /// `.disabled` is the explicit unsigned dev opt-in (trust the app-promoted
    /// record); `.unconfigured`/`.misconfigured` can't authenticate anything and
    /// fail closed to shipped.
    public static func decide(
        knownGood: OTARecord?,
        bytecodeHashMatches: Bool,
        keyState: OTAKeyState,
        recordVerified: Bool
    ) -> WidgetBundleChoice {
        guard let record = knownGood, !record.js.isEmpty else { return .shipped }
        switch keyState {
        case .enforced:
            guard recordVerified else { return .shipped }
        case .unconfigured, .misconfigured:
            return .shipped
        case .disabled:
            break
        }
        return bytecodeHashMatches ? .knownGoodBytecode : .knownGoodSource
    }
}
