import Foundation

/// The ARCH-01 capability gate. An OTA bundle may run on a native binary only if
/// the binary speaks a compatible bridge protocol AND provides every capability
/// `feature` the bundle requires. This replaces a single scalar `hostApiVersion`,
/// which couldn't model app-vs-widget differences or optional/entitled features:
/// a bundle that calls `fetch` needs the "network" feature, which the widget
/// target doesn't provide, so the same bundle can be accepted by the app and
/// rejected by the widget.
///
/// The bundle's required set is derived at build from the host capabilities it
/// actually uses (ARCH-02); the native set is `HostFeatures.<target>` (codegen).
/// Pure Foundation, so it's unit-tested on Linux.
public enum CapabilityGate {
    public enum Decision: Equatable, Sendable {
        case accept
        /// The bundle needs features (or a newer bridge protocol) this binary
        /// lacks. OTA can't fix a too-old app — the user must update it from the
        /// App Store. `missing` lists the absent features (empty when the gap is
        /// only the bridge protocol).
        case updateAppRequired(missing: [String])
    }

    public static func decide(
        bundleBridgeProtocol: Int,
        bundleFeatures: Set<String>,
        nativeBridgeProtocol: Int,
        nativeFeatures: Set<String>
    ) -> Decision {
        let missing = bundleFeatures.subtracting(nativeFeatures)
        guard bundleBridgeProtocol <= nativeBridgeProtocol, missing.isEmpty else {
            return .updateAppRequired(missing: missing.sorted())
        }
        return .accept
    }

    /// Boolean convenience for callers that don't need the missing list.
    public static func accepts(
        bundleBridgeProtocol: Int,
        bundleFeatures: Set<String>,
        nativeBridgeProtocol: Int,
        nativeFeatures: Set<String>
    ) -> Bool {
        decide(
            bundleBridgeProtocol: bundleBridgeProtocol,
            bundleFeatures: bundleFeatures,
            nativeBridgeProtocol: nativeBridgeProtocol,
            nativeFeatures: nativeFeatures
        ) == .accept
    }
}
