import Foundation

// The OTA boot/staging ORCHESTRATION, extracted from the watchOS-only host (M5)
// so the sequencing — decision/re-decision flow, high-water bump ordering,
// boot-attempt counting, known-good promote/restore, record+bytecode pairing —
// is unit-tested on Linux like the pure policies it composes (VersionPolicy,
// CapabilityGate, OTAKeyState, UpdatePlan). Everything platform- or
// crypto-specific is an injected seam: file IO (OTASlotStore), persistence
// counters (OTACounterStore), Ed25519 verification (closures — CryptoKit can't
// compile here), and the JS engine (validate/compile closures at init,
// eval closures per boot call).

/// One persisted OTA slot: a record file plus its compiled-bytecode cache. The
/// host has two — the ACTIVE bundle and the KNOWN-GOOD rollback snapshot
/// (ARCH-04) — backed by App Group files; tests use an in-memory double.
public protocol OTASlotStore: Sendable {
    func readRecordData() -> Data?
    /// Must be atomic (all-or-nothing): the record write is the OTA commit point.
    @discardableResult func writeRecordData(_ data: Data) -> Bool
    func removeRecord()
    func readBytecode() -> Data?
    @discardableResult func writeBytecode(_ data: Data) -> Bool
    func removeBytecode()
}

/// The real slot store: two files in the App Group container. nil URLs (no App
/// Group) read as empty and refuse writes, so staging fails loudly instead of
/// persisting somewhere the widget can't see.
public struct FileOTASlotStore: OTASlotStore {
    public let recordURL: URL?
    public let bytecodeURL: URL?

    public init(recordURL: URL?, bytecodeURL: URL?) {
        self.recordURL = recordURL
        self.bytecodeURL = bytecodeURL
    }

    public func readRecordData() -> Data? {
        recordURL.flatMap { try? Data(contentsOf: $0) }
    }

    @discardableResult
    public func writeRecordData(_ data: Data) -> Bool {
        guard let recordURL else { return false }
        return (try? data.write(to: recordURL, options: .atomic)) != nil
    }

    public func removeRecord() {
        if let recordURL { try? FileManager.default.removeItem(at: recordURL) }
    }

    public func readBytecode() -> Data? {
        bytecodeURL.flatMap { try? Data(contentsOf: $0) }
    }

    @discardableResult
    public func writeBytecode(_ data: Data) -> Bool {
        guard let bytecodeURL else { return false }
        return (try? data.write(to: bytecodeURL, options: .atomic)) != nil
    }

    public func removeBytecode() {
        if let bytecodeURL { try? FileManager.default.removeItem(at: bytecodeURL) }
    }
}

/// The anti-rollback high-water mark and the crash-loop boot-attempt counter.
/// `SharedWidgetStore` already exposes exactly these four (App Group
/// UserDefaults); tests use an in-memory double.
public protocol OTACounterStore: Sendable {
    func otaHighWater() -> Int
    func setOTAHighWater(_ version: Int)
    func otaBootAttempts() -> Int
    func setOTABootAttempts(_ count: Int)
}

extension SharedWidgetStore: OTACounterStore {}

/// Typed result of staging an OTA payload (CX-005 / M5): a refusal carries its
/// user-facing reason directly instead of round-tripping through the host's
/// `@Published runtimeError` UI property.
public enum StageOutcome: Equatable, Sendable {
    case accepted
    case rejected(String)
}

/// What a boot actually ran (M5). `notice` is a user-facing message about a
/// non-fatal detour taken on the way (crash-loop rollback, a failed candidate
/// falling back to shipped).
public enum BootOutcome: Equatable, Sendable {
    /// The persisted OTA record now running (the host keeps it to promote to
    /// known-good on the first healthy commit).
    case ranOTA(OTARecord, notice: String?)
    case ranShipped(notice: String?)
    /// Hard gate: every available bundle is older than one already applied —
    /// show the native "update required" screen instead of running stale JS.
    case blockForUpdate(notice: String?)
}

public struct OTABootSequencer: Sendable {
    /// Thrown when the SHIPPED bundle fails to load (nothing left to fall
    /// back to). Carries the `notice` from an OTA detour taken earlier in the
    /// SAME boot (a dropped candidate, a failed rollback) — without it the
    /// throw would erase the explanation of why the OTA isn't running, and
    /// the user would only see the shipped-load error.
    public struct BootFailure: Error {
        public let underlying: any Error
        public let notice: String?
    }

    public struct Config: Sendable {
        public let keyState: OTAKeyState
        public let gate: OTAGate
        public let shippedVersion: Int
        /// Native side of the ARCH-01 capability gate.
        public let nativeBridgeProtocol: Int
        public let nativeFeatures: Set<String>
        /// The consumer's HostPolicy ceiling (ARCH-07): the EFFECTIVE feature
        /// set the app authorizes a bundle to use. Staging refuses a bundle
        /// requiring anything outside it. Pass the native set when no policy
        /// applies (unrestricted — preserves pre-policy behavior).
        public let policyAllowedFeatures: Set<String>
        public let maxBundleBytes: Int
        public let maxBootAttempts: Int
        /// What clears the crash-loop counter (ARCH-04): the first committed
        /// tree, or the bundle's own `markUpdateHealthy()` call.
        public let healthSignal: OTAHealthSignal

        public init(
            keyState: OTAKeyState, gate: OTAGate, shippedVersion: Int,
            nativeBridgeProtocol: Int, nativeFeatures: Set<String>,
            policyAllowedFeatures: Set<String>,
            maxBundleBytes: Int, maxBootAttempts: Int,
            healthSignal: OTAHealthSignal
        ) {
            self.keyState = keyState
            self.gate = gate
            self.shippedVersion = shippedVersion
            self.nativeBridgeProtocol = nativeBridgeProtocol
            self.nativeFeatures = nativeFeatures
            self.policyAllowedFeatures = policyAllowedFeatures
            self.maxBundleBytes = maxBundleBytes
            self.maxBootAttempts = maxBootAttempts
            self.healthSignal = healthSignal
        }
    }

    private let config: Config
    private let active: any OTASlotStore
    private let knownGood: any OTASlotStore
    private let counters: any OTACounterStore
    /// Whether `keyId` is in the host's baked-in trust map (CX-007 fails closed
    /// on an unknown id, with a distinct message from a bad signature).
    private let hasKey: @Sendable (String) -> Bool
    /// Ed25519 verify of `message` against the trusted key for `keyId`.
    private let verify: @Sendable (_ keyId: String, _ message: Data, _ signature: Data) -> Bool
    /// Read-only validation eval in a throwaway capped runtime (ARCH-04): throws
    /// when the bundle fails to load, including when the runtime can't be made.
    private let validate: @Sendable (String) throws -> Void
    /// Bytecode compile in a throwaway capped runtime; nil on failure (then the
    /// record pins no bytecode and boot parses the source).
    private let compile: @Sendable (String) -> Data?
    /// Clock seam for the signed-expiry checks (tests inject a fixed time).
    private let now: @Sendable () -> Date

    public init(
        config: Config,
        active: any OTASlotStore,
        knownGood: any OTASlotStore,
        counters: any OTACounterStore,
        hasKey: @escaping @Sendable (String) -> Bool,
        verify: @escaping @Sendable (String, Data, Data) -> Bool,
        validate: @escaping @Sendable (String) throws -> Void,
        compile: @escaping @Sendable (String) -> Data?,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.config = config
        self.active = active
        self.knownGood = knownGood
        self.counters = counters
        self.hasKey = hasKey
        self.verify = verify
        self.validate = validate
        self.compile = compile
        self.now = now
    }

    /// Whether a signed expiry (epoch seconds; nil/0 = never) has lapsed —
    /// the revocation lever, enforced wherever the signature is verified.
    private func isExpired(_ expiresAt: Int?) -> Bool {
        guard let expiresAt, expiresAt > 0 else { return false }
        return now().timeIntervalSince1970 > Double(expiresAt)
    }

    // MARK: - Staging (saveUpdate)

    /// Persists an OTA bundle (CR-4 / CR-17). An OTA bundle is arbitrary JS with
    /// the full host surface, so with a key configured the signature is verified
    /// over `scheme:keyId:version:js` *before* it's written — the version is
    /// inside the signed bytes, so it can't be relabelled (anti-rollback in
    /// `boot` can trust it). An unsigned or bad bundle is refused; fail-open
    /// exists only under the explicit `allowUnsignedUpdates` dev opt-in.
    /// Pure of main-thread state, so the host runs it off main (M5).
    public func stage(_ payload: String) -> StageOutcome {
        let plan = UpdatePlan(payload: payload)
        let size = plan.js.utf8.count
        guard size <= config.maxBundleBytes else {
            return .rejected(
                "OTA update rejected: bundle is \(size) bytes, over the "
                    + "\(config.maxBundleBytes)-byte limit")
        }
        // Capability gate (ARCH-01): refuse a bundle needing features this
        // binary doesn't provide, even if validly signed — OTA can't add native
        // code, so the user must update the app. Defense-in-depth behind the JS
        // pre-download gate (update.ts).
        if case .updateAppRequired(let missing) = CapabilityGate.decide(
            bundleBridgeProtocol: plan.minBridgeProtocol,
            bundleFeatures: Set(plan.requiredFeatures),
            nativeBridgeProtocol: config.nativeBridgeProtocol,
            nativeFeatures: config.nativeFeatures
        ) {
            return .rejected(
                "OTA update rejected: needs capabilities this app "
                    + "lacks (\(missing.joined(separator: ", "))) — update the app")
        }
        // Host policy (ARCH-07), checked AFTER the capability gate so when a
        // bundle fails both, the capability wording wins — a binary that can't
        // back a feature needs an App Store update regardless of policy. A
        // pure policy denial is deliberately worded differently: the app CAN
        // back the feature, its configuration just doesn't authorize it.
        let policyDenied = Set(plan.requiredFeatures)
            .subtracting(config.policyAllowedFeatures)
        if !policyDenied.isEmpty {
            return .rejected(
                "OTA update rejected: blocked by this app's host policy "
                    + "(\(policyDenied.sorted().joined(separator: ", "))) — "
                    + "requires an app configuration change")
        }
        switch config.keyState {
        case .unconfigured:
            // NF-29: the secure zero-config default — no keys and no explicit
            // dev opt-in means new OTA bundles are refused, not silently accepted.
            return .rejected(
                "OTA update rejected: no signing keys configured — set "
                    + "OTAConfig.signerPublicKeys (or allowUnsignedUpdates for dev builds)")
        case .misconfigured:
            // CX-003: keys were configured but none decoded — the developer opted
            // into enforcement but misconfigured it. Refuse loudly; never fall
            // through to the fail-open branch below.
            return .rejected(
                "OTA update rejected: signing keys are misconfigured (every "
                    + "configured key failed to decode) — fix OTAConfig.signerPublicKeys")
        case .enforced:
            // Fail closed on an unknown key id (CX-007): an attacker-supplied
            // `keyId` can only ever resolve to a key in the baked-in map — never
            // outside the pinned trust set (the JWT `kid`-confusion lesson). The
            // same `keyId` selects the key AND is bound into `signedMessage`, so
            // the verified bytes commit to *which* key signed *this* bundle.
            guard let keyId = plan.keyId, hasKey(keyId) else {
                return .rejected("OTA update rejected: unknown or missing signing key id")
            }
            guard let signature = plan.signature, let version = plan.version,
                let message = plan.signedMessage(),
                verify(keyId, message, signature)
            else {
                return .rejected("OTA update rejected: signature/version missing or invalid")
            }
            // The revocation lever: the expiry is inside the verified bytes
            // (scheme v2), so it can't be stripped — refuse a lapsed bundle
            // even though its signature is valid.
            if isExpired(plan.expiresAt) {
                return .rejected(
                    "OTA update rejected: the bundle's signature expired — "
                        + "publish a freshly signed release")
            }
            let highWater = counters.otaHighWater()
            guard VersionPolicy.accepts(incoming: version, highWater: highWater) else {
                return .rejected(
                    "OTA update rejected: version \(version) is older than the "
                        + "installed \(highWater) (downgrade blocked)")
            }
            return persist(
                js: plan.js, keyId: keyId, version: version,
                signature: signature.base64EncodedString(),
                expiresAt: plan.expiresAt)
        case .disabled:
            // The explicit dev fail-open: persisted unverified (the host warns).
            return persist(
                js: plan.js, keyId: plan.keyId, version: plan.version,
                signature: nil, expiresAt: nil)
        }
    }

    private func persist(
        js: String, keyId: String?, version: Int?, signature: String?,
        expiresAt: Int?
    ) -> StageOutcome {
        // Read-only validation (ARCH-04): eval the candidate in a throwaway
        // runtime with no host callbacks, so a bundle that throws on load is
        // caught BEFORE we persist it and its module init can't touch real state.
        do {
            try validate(js)
        } catch {
            return .rejected("OTA update rejected: bundle failed to evaluate: \(error)")
        }
        // Compile the bytecode first so the record can pin the exact blob written
        // (OP-1); a nil hash just means boot will parse the source. NOT under
        // enforced keys: neither the app boot (evalOTA) nor the widget
        // (WidgetBundleChoice) will run unsigned-hash bytecode under
        // enforcement, so compiling would be a wasted full parse plus flash
        // writes per staged update for an artifact nothing runs. Clearing the
        // cache keeps a blob from an earlier unsigned phase from lingering.
        let bytecodeHash: String?
        if config.keyState == .enforced {
            active.removeBytecode()
            bytecodeHash = nil
        } else {
            bytecodeHash = cacheBytecode(source: js)
        }
        let record = OTARecord(
            js: js, keyId: keyId, version: version, signature: signature,
            bytecodeHash: bytecodeHash, expiresAt: expiresAt
        )
        let replacesADifferentBundle = loadRecord(from: active) != record
        // ONE atomic write is the commit point (ARCH-04): a crash before it
        // leaves the previous record (or none) intact — never a new source paired
        // with a stale version/signature.
        guard let data = try? JSONEncoder().encode(record),
            active.writeRecordData(data)
        else {
            return .rejected("OTA update rejected: could not write bundle record")
        }
        // A new artifact in the slot gets its own boot budget — the per-slot
        // retry count Android A/B keeps, and the per-entry counter systemd keeps
        // in the loader filename (docs/prior-art.md). Without this, the counter
        // left by the bundle being REPLACED rolls the new one back before it has
        // booted once: a bundle that boots fine but never confirms (`.explicit`)
        // climbs to maxBootAttempts, the fix is staged behind it, and the next
        // launch takes the crash-loop branch against a bundle that never ran —
        // deleting the fix and blaming it for its predecessor's failure.
        //
        // Only on a CHANGED record: re-staging identical bytes must not let a
        // bundle clear its own crash-loop counter every launch, which is exactly
        // the render-then-die case `.explicit` exists to catch.
        if replacesADifferentBundle {
            counters.setOTABootAttempts(0)
        }
        return .accepted
    }

    /// Compiles the just-verified source to bytecode now (CR-17) so the next
    /// cold start skips the parser. Returns the hash of the blob written (to pin
    /// it in the record), or nil if compilation/write failed — then the stale
    /// cache is dropped and boot falls back to the source.
    private func cacheBytecode(source: String) -> String? {
        if let bytecode = compile(source), active.writeBytecode(bytecode) {
            return ContentHash.of(bytecode)
        }
        active.removeBytecode()
        return nil
    }

    // MARK: - Boot

    /// Decides and runs what this launch boots. The eval closures are the JS
    /// engine seam (called synchronously, in the caller's isolation):
    /// `evalSource`/`evalBytecode` run an OTA artifact, `evalShipped` runs the
    /// bundle inside the app binary. Throws only when the SHIPPED bundle fails
    /// to load (nothing left to fall back to); every OTA failure falls through
    /// with a `notice`.
    public func boot(
        evalSource: (_ source: String) throws -> Void,
        evalBytecode: (_ bytecode: Data, _ source: String) throws -> Void,
        evalShipped: () throws -> Void
    ) throws -> BootOutcome {
        let candidate = candidateRecord()
        let decision: BootDecision =
            if config.keyState == .disabled {
                // Fail-open ONLY on the explicit allowUnsignedUpdates dev opt-in
                // (CX-003/NF-29): versions are unverified, so no anti-rollback —
                // run the OTA bundle if present, else shipped.
                candidate != nil ? .runOTA : .runShipped
            } else if config.keyState == .misconfigured || config.keyState == .unconfigured {
                // Fail CLOSED (CX-003): with no usable signing key we cannot
                // authenticate a stored record from the writable App Group, so
                // never run an OTA candidate — an attacker-planted record would
                // otherwise execute unverified (the NF-35 hole). Run shipped. The
                // candidate is KEPT, not dropped: once the key config is fixed the
                // enforced path re-verifies and runs it. verifyStored only
                // *verifies* under .enforced, so without this gate these states
                // would reach evalOTA and skip the signature check entirely.
                .runShipped
            } else {
                VersionPolicy.decide(
                    otaVersion: candidate.flatMap(\.version),
                    highWater: counters.otaHighWater(),
                    shippedVersion: config.shippedVersion,
                    gate: config.gate
                )
            }
        var notice: String?
        switch decision {
        case .runOTA:
            if let c = candidate {
                // Crash-loop rollback (ARCH-04): the JS-throw path is caught
                // below, but a *native* crash on boot (QuickJS OOM, a Swift trap
                // in a host callback) kills the process before that catch — a
                // bundle that does so bricks every launch. otaBootAttempts counts
                // boots that haven't reached a healthy commit (which resets it);
                // once it hits the cap, roll back — to a previously-healthy OTA if
                // there is one (and it doesn't break anti-rollback), else shipped.
                if counters.otaBootAttempts() >= config.maxBootAttempts {
                    let knownGoodRecord = loadRecord(from: knownGood)
                    let recovery = VersionPolicy.crashLoopRecovery(
                        hasKnownGood: knownGoodRecord != nil,
                        knownGoodMatchesActive: knownGoodRecord == c,
                        knownGoodVersion: knownGoodRecord?.version,
                        highWater: counters.otaHighWater(),
                        shippedVersion: config.shippedVersion,
                        gate: config.gate,
                        enforcing: config.keyState != .disabled
                    )
                    if recovery == .rollBackToKnownGood, let good = restoreKnownGood() {
                        // This launch is the restored bundle's first boot attempt;
                        // if it ALSO crash-loops, next time knownGood == active →
                        // dropToShipped (so the rollback can't loop forever).
                        counters.setOTABootAttempts(1)
                        do {
                            try evalOTA(good, evalSource: evalSource, evalBytecode: evalBytecode)
                            bumpHighWater(good.version)
                            return .ranOTA(
                                good,
                                notice: "OTA bundle crash-looped — rolled back to the "
                                    + "previous working bundle")
                        } catch {
                            dropActive()
                            dropKnownGood()
                            counters.setOTABootAttempts(0)
                            notice = "OTA rollback bundle also failed, using shipped: \(error)"
                        }
                    } else {
                        dropActive()
                        dropKnownGood()
                        counters.setOTABootAttempts(0)
                        notice =
                            "OTA bundle rolled back: failed to boot "
                            + "\(config.maxBootAttempts)× — using shipped bundle"
                    }
                } else {
                    counters.setOTABootAttempts(counters.otaBootAttempts() + 1)
                    do {
                        try evalOTA(c, evalSource: evalSource, evalBytecode: evalBytecode)
                        bumpHighWater(c.version)
                        return .ranOTA(c, notice: nil)
                    } catch {
                        dropActive()
                        counters.setOTABootAttempts(0)
                        notice = "OTA bundle failed, using shipped bundle: \(error)"
                    }
                }
            }
        case .blockForUpdate:
            // Hard gate: the only available bundle is older than one already
            // applied — refuse to boot it so it can't write to a newer-schema db.
            return .blockForUpdate(notice: nil)
        case .runShipped:
            break
        }
        // Reached here either because the policy chose shipped, or because a
        // chosen OTA candidate was rejected (NF-35 re-verification threw, the
        // bundle failed to execute, or a crash-loop rollback gave up) and the
        // catches above fell through. In the latter case the earlier
        // `.runOTA` decision is stale: the candidate no longer exists, so
        // re-run the boot policy with NO candidate. Under a hard gate with a
        // stale shipped bundle (below the high-water mark) that yields
        // `.blockForUpdate` — otherwise a tampered/failed candidate would let
        // stale JS boot and write to a newer-schema db, defeating anti-rollback
        // (CR-17). `.disabled` has no anti-rollback by design, so it always
        // boots shipped.
        if config.keyState != .disabled,
            VersionPolicy.decide(
                otaVersion: nil,
                highWater: counters.otaHighWater(),
                shippedVersion: config.shippedVersion,
                gate: config.gate
            ) == .blockForUpdate
        {
            return .blockForUpdate(notice: notice)
        }
        do {
            try evalShipped()
        } catch {
            // Wrap so the OTA-detour notice survives the throw (the host
            // surfaces both: the notice as runtimeError, the underlying
            // error as startupError).
            throw BootFailure(underlying: error, notice: notice)
        }
        if config.keyState != .disabled {
            bumpHighWater(config.shippedVersion)
        }
        return .ranShipped(notice: notice)
    }

    /// Called on the first healthy commit of a launch: clear the crash-loop
    /// counter so only *boot* failures accumulate (ARCH-04), and snapshot the
    /// running OTA bundle as the known-good rollback target (no-op when running
    /// shipped, or when the snapshot already matches). Idempotent; after the
    /// first reset it's a no-op.
    public func markHealthy(bootedRecord: OTARecord?) {
        guard counters.otaBootAttempts() != 0 else { return }
        counters.setOTABootAttempts(0)
        if let bootedRecord { promoteToKnownGood(bootedRecord) }
    }

    /// Whether a first committed tree is enough to bless THIS boot's bundle, or
    /// whether the bundle must call `markUpdateHealthy()` itself (ARCH-04's
    /// `bundleReady`). Both triggers land on the same `markHealthy`.
    ///
    /// Under `.explicit` there are two carve-outs, because the explicit bar is
    /// only meaningful for an OTA bundle that hasn't proved itself yet:
    /// - **Shipped boots self-bless** (`bootedRecord == nil`). The shipped
    ///   bundle is inside the code-signed binary and predates the API; without
    ///   this a non-zero counter left by a dropped OTA would survive into the
    ///   next staged bundle and roll it back early.
    /// - **Already-blessed bundles self-bless** (the booted record IS the
    ///   known-good snapshot). This is the config-flip case: a consumer turns
    ///   on `.explicit` in a new app release while an OTA bundle that predates
    ///   the API is installed and already promoted. Without the carve-out that
    ///   healthy bundle crash-loops, finds `knownGood == active`, and drops all
    ///   the way to shipped.
    ///
    /// Deliberately NOT cheap (the known-good check is a file read), so the
    /// host computes it once per boot rather than per commit.
    public func commitBlesses(bootedRecord: OTARecord?) -> Bool {
        if config.healthSignal == .firstCommit { return true }
        guard let bootedRecord else { return true }
        return loadRecord(from: knownGood) == bootedRecord
    }

    // MARK: - Private boot plumbing

    /// The persisted OTA bundle + its version. Verified at save (the network
    /// boundary) AND re-verified at every boot when keys are enforced
    /// (verifyStored, NF-35); unsigned records exist only under the explicit
    /// dev opt-in. nil if none.
    private func candidateRecord() -> OTARecord? {
        guard let record = loadRecord(from: active), !record.js.isEmpty else { return nil }
        return record
    }

    private func loadRecord(from slot: any OTASlotStore) -> OTARecord? {
        guard let data = slot.readRecordData() else { return nil }
        return try? JSONDecoder().decode(OTARecord.self, from: data)
    }

    /// NF-35: with keys enforced, a stored record must re-verify at every
    /// boot — otherwise "verified at save" silently degrades to "whoever can
    /// write the App Group container owns the runtime". Unsigned records under
    /// the explicit dev opt-in (.disabled) skip this by design;
    /// .unconfigured/.misconfigured never reach here (boot fails them closed
    /// to the shipped bundle).
    private func verifyStored(_ record: OTARecord) throws {
        guard config.keyState == .enforced else { return }
        guard let keyId = record.keyId, hasKey(keyId),
            let signatureB64 = record.signature,
            let signature = Data(base64Encoded: signatureB64),
            let message = record.signedMessage(),
            verify(keyId, message, signature)
        else {
            throw OTAVerifyError.storedRecordFailedVerification
        }
        // Checked at EVERY boot, not just at save (the revocation lever): a
        // bundle whose signed expiry lapsed on-device stops running on the
        // next launch and the boot falls back per the normal drop path.
        if isExpired(record.expiresAt) {
            throw OTAVerifyError.storedRecordExpired
        }
    }

    private enum OTAVerifyError: Error, CustomStringConvertible {
        case storedRecordFailedVerification
        case storedRecordExpired

        var description: String {
            switch self {
            case .storedRecordFailedVerification:
                "stored OTA record failed signature re-verification — dropped"
            case .storedRecordExpired:
                "stored OTA record's signed expiry has lapsed — dropped"
            }
        }
    }

    /// Every OTA boot path (the candidate and the crash-loop known-good restore)
    /// funnels through here — the one choke point for NF-35 re-verification and
    /// the bytecode-trust rule.
    private func evalOTA(
        _ record: OTARecord,
        evalSource: (String) throws -> Void,
        evalBytecode: (Data, String) throws -> Void
    ) throws {
        try verifyStored(record)
        // Trust the cached App-Group bytecode ONLY when keys aren't enforced.
        // The signature covers the SOURCE (scheme:keyId:version:js) — NOT the
        // on-device-compiled `.qbc`, whose only integrity check is the record's
        // OWN `bytecodeHash`, an unsigned field an App-Group writer also controls.
        // Under enforcement, trusting that hash would let such a writer pin it to
        // a malicious blob and run arbitrary bytecode despite a valid signature
        // (defeats NF-35), so we always run the boot-re-verified source instead.
        // The bytecode fast-path stays valid off-enforcement (dev/unsigned, no
        // security claim) and for the shipped bundle (inside the signed app
        // bundle, where no untrusted writer exists).
        if config.keyState != .enforced,
            let data = active.readBytecode(),
            record.bytecodeHash == ContentHash.of(data)
        {
            do {
                try evalBytecode(data, record.js)
                return
            } catch {
                active.removeBytecode()  // engine-version stale
            }
        }
        try evalSource(record.js)
    }

    private func bumpHighWater(_ booted: Int?) {
        guard let booted else { return }
        counters.setOTAHighWater(
            VersionPolicy.bumpedHighWater(counters.otaHighWater(), booted: booted))
    }

    private func dropActive() {
        active.removeRecord()
        active.removeBytecode()
    }

    private func dropKnownGood() {
        knownGood.removeRecord()
        knownGood.removeBytecode()
    }

    /// Snapshot the active OTA bundle as the known-good rollback target (ARCH-04).
    /// Idempotent: skips the write when the snapshot already equals the record.
    private func promoteToKnownGood(_ record: OTARecord) {
        if loadRecord(from: knownGood) == record { return }
        guard let data = try? JSONEncoder().encode(record),
            knownGood.writeRecordData(data)
        else { return }
        // Carry the bytecode too so the rollback boot also skips the parser; a
        // missing/failed copy just means the restored bundle parses its source.
        copyBytecode(from: active, to: knownGood)
    }

    /// Restore the known-good snapshot as the active OTA bundle (ARCH-04
    /// crash-loop rollback). Returns the restored record so boot can run it this
    /// launch, or nil if there was nothing to restore.
    private func restoreKnownGood() -> OTARecord? {
        guard let good = loadRecord(from: knownGood),
            let data = try? JSONEncoder().encode(good),
            active.writeRecordData(data)
        else { return nil }
        copyBytecode(from: knownGood, to: active)
        return good
    }

    /// Replace `dst`'s bytecode with a copy of `src`'s (best-effort); removes
    /// `dst` first so a stale blob is cleared even when `src` is absent (so
    /// bytecode never outlives its record).
    private func copyBytecode(from src: any OTASlotStore, to dst: any OTASlotStore) {
        dst.removeBytecode()
        if let data = src.readBytecode() { dst.writeBytecode(data) }
    }
}
