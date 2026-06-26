// Decides what the watch boots, given OTA versioning state. Pure logic, so the
// anti-rollback + stale-state rules are unit-tested off-device; the host wires
// it to persistence (high-water mark) and CryptoKit (signature) — the trust
// root, since the JS is itself OTA-replaceable.
//
// The version is a *compatibility* integer the developer bumps only on a
// breaking change (db schema / wire contract). Anti-rollback refuses anything
// below the high-water mark, so an older bundle can never run against a
// newer-schema db — which is the whole point of the hard gate.

/// How aggressively to refuse stale JS. `soft` runs the best available bundle
/// and lets the app show an "update available" prompt; `hard` refuses to boot
/// stale JS at all, so it can't touch the db.
public enum OTAGate: Sendable, Equatable {
    case soft
    case hard
}

/// What the host should do at boot.
public enum BootDecision: Sendable, Equatable {
    /// The persisted OTA bundle is current — run it.
    case runOTA
    /// No usable OTA bundle; the shipped bundle is acceptable — run it.
    case runShipped
    /// We've already run a newer version than anything available now (lost OTA
    /// / state loss) and the gate is hard — don't boot stale JS; prompt to
    /// update instead.
    case blockForUpdate
}

/// Where to land when the active OTA bundle has crash-looped (ARCH-04): prefer a
/// previously-HEALTHY OTA bundle over dropping all the way to shipped — but only
/// when that known-good still satisfies anti-rollback.
public enum CrashLoopRecovery: Sendable, Equatable {
    /// Restore the known-good snapshot as the active bundle and boot it.
    case rollBackToKnownGood
    /// No usable known-good — drop the OTA and boot the shipped bundle.
    case dropToShipped
}

public enum VersionPolicy {
    /// Whether `saveUpdate` may accept an incoming bundle. Anti-rollback: never
    /// below the high-water mark. Equal is allowed — non-breaking updates share
    /// a version and are interchangeable.
    public static func accepts(incoming: Int, highWater: Int) -> Bool {
        incoming >= highWater
    }

    /// What to boot. `otaVersion` is the persisted OTA bundle's version (nil if
    /// none/invalid), `shippedVersion` is baked into the native app.
    public static func decide(
        otaVersion: Int?,
        highWater: Int,
        shippedVersion: Int,
        gate: OTAGate
    ) -> BootDecision {
        if let ota = otaVersion, ota >= highWater {
            return .runOTA
        }
        if shippedVersion >= highWater {
            return .runShipped
        }
        // Shipped is older than what we've already applied: a real downgrade.
        return gate == .hard ? .blockForUpdate : .runShipped
    }

    /// The new high-water after successfully booting `booted`. Monotonic.
    public static func bumpedHighWater(_ highWater: Int, booted: Int) -> Int {
        max(highWater, booted)
    }

    /// What to do when the active OTA bundle has failed to reach a healthy boot
    /// the maximum number of times (ARCH-04 crash-loop guard). Prefer rolling
    /// back to a previously-HEALTHY OTA bundle (a strong "this ran fine on this
    /// device" signal) over dropping to the older shipped bundle — but never to a
    /// known-good that would violate anti-rollback (running old code against a
    /// newer-schema db), so an enforced rollback reuses `decide`.
    ///
    /// - `knownGoodMatchesActive`: the snapshot IS the bundle that just failed
    ///   (it booted healthy once, was promoted, then later crash-looped — e.g. an
    ///   OS update broke it). Rolling back to it would loop, so drop to shipped.
    /// - `enforcing`: keys are configured (anti-rollback is live). When false
    ///   (fail-open, no keys → versions unverified), there's no rollback gate, so
    ///   any differing known-good is a valid restore target.
    public static func crashLoopRecovery(
        hasKnownGood: Bool,
        knownGoodMatchesActive: Bool,
        knownGoodVersion: Int?,
        highWater: Int,
        shippedVersion: Int,
        gate: OTAGate,
        enforcing: Bool
    ) -> CrashLoopRecovery {
        guard hasKnownGood, !knownGoodMatchesActive else { return .dropToShipped }
        if !enforcing { return .rollBackToKnownGood }
        return decide(
            otaVersion: knownGoodVersion, highWater: highWater,
            shippedVersion: shippedVersion, gate: gate
        ) == .runOTA ? .rollBackToKnownGood : .dropToShipped
    }
}
