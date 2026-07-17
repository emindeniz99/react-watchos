import Foundation

/// The ARCH-07 host policy: the CONSUMER's authorization decision — may a
/// bundle use a feature this binary can back — kept deliberately separate from
/// `CapabilityGate` (ARCH-01), which decides only whether the binary CAN back
/// it (compatibility). A validly signed OTA bundle is arbitrary code with every
/// native privilege the host installs; the policy is the least-privilege lever:
/// sensitive features (health, BLE, network, notifications, AI, …) stay off
/// unless the app explicitly allows them, and turning one on requires a native
/// release — an app configuration change, never "update the app".
///
/// Pure Foundation, so it's unit-tested on Linux.
public enum HostPolicy: Sendable {
    /// No restriction: every feature the binary provides is authorized.
    case allowAll
    /// Only the listed features are authorized (intersected with what the
    /// binary actually provides; unknown names are ignored).
    case allow(Set<String>)

    /// Authorization outcome for a bundle's required features. A distinct type
    /// from `CapabilityGate.Decision` on purpose: a policy denial must never be
    /// presented as "update the app" — the app already CAN back the feature,
    /// its configuration just doesn't allow it.
    public enum Decision: Sendable, Equatable {
        case authorized
        /// Features the bundle requires that the policy doesn't authorize
        /// (sorted). Fixable only by an app configuration change.
        case denied(byPolicy: [String])
    }

    /// The feature set the runtime actually installs and advertises: the
    /// policy's allowlist intersected with `native` (a policy can't invent a
    /// feature the binary lacks) — plus "core" whenever `native` contains it.
    /// "core" is the commit/log/timers/invoke infrastructure: a policy that
    /// dropped it would brick the runtime, so it is not separately gateable.
    public func effectiveFeatures(native: Set<String>) -> Set<String> {
        switch self {
        case .allowAll:
            return native
        case .allow(let allowed):
            var effective = allowed.intersection(native)
            if native.contains("core") { effective.insert("core") }
            return effective
        }
    }

    /// Whether a bundle whose build requires `bundleFeatures` is authorized to
    /// run under this policy on a binary providing `native`. Callers should
    /// check `CapabilityGate` FIRST — a feature that's missing natively is a
    /// compatibility gap ("update the app"), not a policy denial.
    public func authorize(
        bundleFeatures: Set<String>, native: Set<String>
    ) -> Decision {
        let denied = bundleFeatures.subtracting(effectiveFeatures(native: native))
        guard denied.isEmpty else { return .denied(byPolicy: denied.sorted()) }
        return .authorized
    }
}
