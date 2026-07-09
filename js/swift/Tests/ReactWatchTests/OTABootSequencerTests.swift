import Foundation
import ReactWatchSupport
import XCTest

// Linux-run tests for the OTA boot/staging ORCHESTRATION (M5) — the
// decision/re-decision flow, high-water bump ordering, boot-attempt counting,
// known-good promote/restore, and record+bytecode pairing that used to live
// untested in the watchOS-only host. Crypto and the JS engine are stubbed at
// the sequencer's injected seams; the pure policies they compose
// (VersionPolicy, CapabilityGate, UpdatePlan) have their own suites.

/// In-memory OTASlotStore. `@unchecked Sendable` is fine here: each test drives
/// its sequencer from a single thread.
private final class MemorySlot: OTASlotStore, @unchecked Sendable {
    var record: Data?
    var bytecode: Data?
    var failRecordWrites = false

    func readRecordData() -> Data? { record }

    @discardableResult
    func writeRecordData(_ data: Data) -> Bool {
        if failRecordWrites { return false }
        record = data
        return true
    }

    func removeRecord() { record = nil }

    func readBytecode() -> Data? { bytecode }

    @discardableResult
    func writeBytecode(_ data: Data) -> Bool {
        bytecode = data
        return true
    }

    func removeBytecode() { bytecode = nil }
}

private final class MemoryCounters: OTACounterStore, @unchecked Sendable {
    var highWater = 0
    var attempts = 0

    func otaHighWater() -> Int { highWater }
    func setOTAHighWater(_ version: Int) { highWater = version }
    func otaBootAttempts() -> Int { attempts }
    func setOTABootAttempts(_ count: Int) { attempts = count }
}

final class OTABootSequencerTests: XCTestCase {
    private var active = MemorySlot()
    private var knownGood = MemorySlot()
    private var counters = MemoryCounters()

    override func setUp() {
        super.setUp()
        active = MemorySlot()
        knownGood = MemorySlot()
        counters = MemoryCounters()
    }

    /// The stub trust set: key "k1" is known; a signature is valid iff its raw
    /// bytes are "good" (base64 "Z29vZA==" on the wire).
    private static let goodSignature = Data("good".utf8)
    private static let goodSignatureB64 = "Z29vZA=="

    /// The fixed test clock (epoch seconds) the sequencer's expiry checks see.
    private static let testNow = 1_000_000

    private func makeSequencer(
        keyState: OTAKeyState = .enforced,
        gate: OTAGate = .soft,
        shippedVersion: Int = 1,
        maxBundleBytes: Int = 4096,
        maxBootAttempts: Int = 3,
        validate: @escaping @Sendable (String) throws -> Void = { _ in },
        compile: @escaping @Sendable (String) -> Data? = { Data("qbc:\($0)".utf8) }
    ) -> OTABootSequencer {
        OTABootSequencer(
            config: .init(
                keyState: keyState, gate: gate, shippedVersion: shippedVersion,
                nativeBridgeProtocol: 1, nativeFeatures: ["network"],
                maxBundleBytes: maxBundleBytes, maxBootAttempts: maxBootAttempts),
            active: active,
            knownGood: knownGood,
            counters: counters,
            hasKey: { $0 == "k1" },
            verify: { _, _, signature in signature == Self.goodSignature },
            validate: validate,
            compile: compile,
            now: { Date(timeIntervalSince1970: Double(Self.testNow)) }
        )
    }

    private func signedPayload(
        js: String = "app()", version: Int = 2, expiresAt: Int? = nil
    ) -> String {
        let expiry = expiresAt.map { #","expiresAt":\#($0)"# } ?? ""
        return
            #"{"js":"\#(js)","keyId":"k1","version":\#(version),"signature":"\#(Self.goodSignatureB64)"\#(expiry)}"#
    }

    private func storeRecord(
        _ record: OTARecord, in slot: MemorySlot, bytecode: Data? = nil
    ) {
        slot.record = try? JSONEncoder().encode(record)
        slot.bytecode = bytecode
    }

    private func signedRecord(
        js: String = "app()", version: Int = 2, bytecodeHash: String? = nil,
        expiresAt: Int? = nil
    ) -> OTARecord {
        OTARecord(
            js: js, keyId: "k1", version: version,
            signature: Self.goodSignatureB64, bytecodeHash: bytecodeHash,
            expiresAt: expiresAt)
    }

    private func decodeActiveRecord() -> OTARecord? {
        active.record.flatMap { try? JSONDecoder().decode(OTARecord.self, from: $0) }
    }

    // MARK: - Staging gates, in order

    func testStageRejectsOversizedBundle() {
        let seq = makeSequencer(maxBundleBytes: 4)
        guard case .rejected(let reason) = seq.stage(signedPayload(js: "12345")) else {
            return XCTFail("expected rejection")
        }
        XCTAssertTrue(reason.contains("over the 4-byte limit"))
        XCTAssertNil(active.record)
    }

    func testStageRejectsMissingCapabilityEvenWhenSigned() {
        let seq = makeSequencer()
        let payload =
            #"{"js":"app()","keyId":"k1","version":2,"signature":"Z29vZA==","#
            + #""requiredFeatures":["ble"],"minBridgeProtocol":1}"#
        guard case .rejected(let reason) = seq.stage(payload) else {
            return XCTFail("expected rejection")
        }
        XCTAssertTrue(reason.contains("needs capabilities"))
        XCTAssertTrue(reason.contains("ble"))
    }

    func testStageUnconfiguredRefusesLoudly() {
        let seq = makeSequencer(keyState: .unconfigured)
        guard case .rejected(let reason) = seq.stage(signedPayload()) else {
            return XCTFail("expected rejection")
        }
        XCTAssertTrue(reason.contains("no signing keys configured"))
    }

    func testStageMisconfiguredNeverFallsOpen() {
        let seq = makeSequencer(keyState: .misconfigured)
        guard case .rejected(let reason) = seq.stage(signedPayload()) else {
            return XCTFail("expected rejection")
        }
        XCTAssertTrue(reason.contains("misconfigured"))
        XCTAssertNil(active.record)
    }

    func testStageEnforcedRejectsUnknownKeyId() {
        let seq = makeSequencer()
        let payload =
            #"{"js":"app()","keyId":"evil","version":2,"signature":"Z29vZA=="}"#
        guard case .rejected(let reason) = seq.stage(payload) else {
            return XCTFail("expected rejection")
        }
        XCTAssertTrue(reason.contains("unknown or missing signing key id"))
    }

    func testStageEnforcedRejectsBadSignature() {
        let seq = makeSequencer()
        let bad = Data("evil".utf8).base64EncodedString()
        let payload = #"{"js":"app()","keyId":"k1","version":2,"signature":"\#(bad)"}"#
        guard case .rejected(let reason) = seq.stage(payload) else {
            return XCTFail("expected rejection")
        }
        XCTAssertTrue(reason.contains("signature/version missing or invalid"))
    }

    func testStageEnforcedRejectsDowngrade() {
        counters.highWater = 5
        let seq = makeSequencer()
        guard case .rejected(let reason) = seq.stage(signedPayload(version: 2)) else {
            return XCTFail("expected rejection")
        }
        XCTAssertTrue(reason.contains("downgrade blocked"))
    }

    func testStageAcceptsEqualVersionAndPersistsRecordWithoutBytecodeUnderEnforcement() {
        counters.highWater = 2
        // A blob left over from an earlier unsigned phase must not linger.
        active.bytecode = Data("stale".utf8)
        let seq = makeSequencer()
        XCTAssertEqual(seq.stage(signedPayload(version: 2)), .accepted)
        let record = decodeActiveRecord()
        XCTAssertEqual(record?.js, "app()")
        XCTAssertEqual(record?.keyId, "k1")
        XCTAssertEqual(record?.version, 2)
        XCTAssertEqual(record?.signature, Self.goodSignatureB64)
        // Under enforced keys nothing runs unsigned-hash bytecode (evalOTA and
        // WidgetBundleChoice both refuse it), so staging skips the compile and
        // the flash writes entirely and pins nothing.
        XCTAssertNil(active.bytecode)
        XCTAssertNil(record?.bytecodeHash)
    }

    func testStageDisabledPinsCompiledBytecode() {
        // Off-enforcement (unsigned dev opt-in) the bytecode fast path is live:
        // the record pins the exact compiled blob written next to it (OP-1).
        let seq = makeSequencer(keyState: .disabled)
        XCTAssertEqual(seq.stage(signedPayload(version: 2)), .accepted)
        XCTAssertEqual(active.bytecode, Data("qbc:app()".utf8))
        XCTAssertEqual(
            decodeActiveRecord()?.bytecodeHash,
            ContentHash.of(Data("qbc:app()".utf8)))
    }

    func testStageValidatorFailureRejectsBeforePersisting() {
        struct Boom: Error {}
        let seq = makeSequencer(validate: { _ in throw Boom() })
        guard case .rejected(let reason) = seq.stage(signedPayload()) else {
            return XCTFail("expected rejection")
        }
        XCTAssertTrue(reason.contains("failed to evaluate"))
        XCTAssertNil(active.record)
        XCTAssertNil(active.bytecode)
    }

    func testStageCompileFailureDropsStaleCacheAndPinsNothing() {
        // .disabled so the cacheBytecode failure branch itself is exercised —
        // under .enforced the compile is skipped before it could fail.
        active.bytecode = Data("stale".utf8)
        let seq = makeSequencer(keyState: .disabled, compile: { _ in nil })
        XCTAssertEqual(seq.stage(signedPayload()), .accepted)
        XCTAssertNil(active.bytecode, "stale cache must not outlive its record")
        XCTAssertNil(decodeActiveRecord()?.bytecodeHash)
    }

    func testStageWriteFailureRejects() {
        active.failRecordWrites = true
        let seq = makeSequencer()
        guard case .rejected(let reason) = seq.stage(signedPayload()) else {
            return XCTFail("expected rejection")
        }
        XCTAssertTrue(reason.contains("could not write"))
    }

    func testStageDisabledPersistsUnsignedBarePayload() {
        let seq = makeSequencer(keyState: .disabled)
        XCTAssertEqual(seq.stage("app()"), .accepted)
        let record = decodeActiveRecord()
        XCTAssertEqual(record?.js, "app()")
        XCTAssertNil(record?.version)
        XCTAssertNil(record?.signature)
    }

    // MARK: - Boot decisions

    /// Runs boot with recording eval closures; `sourceThrows`/`bytecodeThrows`
    /// make the FIRST matching eval fail (like a bundle that throws on load).
    private func runBoot(
        _ seq: OTABootSequencer,
        sourceThrows: Bool = false,
        bytecodeThrows: Bool = false
    ) throws -> (outcome: BootOutcome, sources: [String], bytecodes: [Data], shipped: Int) {
        struct EvalError: Error {}
        var sources: [String] = []
        var bytecodes: [Data] = []
        var shipped = 0
        let outcome = try seq.boot(
            evalSource: { source in
                sources.append(source)
                if sourceThrows { throw EvalError() }
            },
            evalBytecode: { bytecode, _ in
                bytecodes.append(bytecode)
                if bytecodeThrows { throw EvalError() }
            },
            evalShipped: { shipped += 1 }
        )
        return (outcome, sources, bytecodes, shipped)
    }

    func testBootRunsShippedWhenNoCandidateAndBumpsHighWater() throws {
        counters.highWater = 3
        let seq = makeSequencer(shippedVersion: 4)
        let run = try runBoot(seq)
        XCTAssertEqual(run.outcome, .ranShipped(notice: nil))
        XCTAssertEqual(run.shipped, 1)
        XCTAssertEqual(counters.highWater, 4)
    }

    func testBootDisabledNeverBumpsHighWater() throws {
        let seq = makeSequencer(keyState: .disabled, shippedVersion: 4)
        _ = try runBoot(seq)
        XCTAssertEqual(counters.highWater, 0, "fail-open has no anti-rollback")
    }

    func testBootRunsOTACountsAttemptAndBumpsHighWater() throws {
        storeRecord(signedRecord(version: 2), in: active)
        let seq = makeSequencer()
        let run = try runBoot(seq)
        XCTAssertEqual(run.outcome, .ranOTA(signedRecord(version: 2), notice: nil))
        XCTAssertEqual(run.sources, ["app()"])
        XCTAssertEqual(counters.attempts, 1, "resets only on the healthy commit")
        XCTAssertEqual(counters.highWater, 2)
        XCTAssertEqual(run.shipped, 0)
    }

    func testBootEnforcedNeverTrustsBytecodeEvenWithMatchingHash() throws {
        let blob = Data("qbc".utf8)
        storeRecord(
            signedRecord(bytecodeHash: ContentHash.of(blob)), in: active, bytecode: blob)
        let seq = makeSequencer()
        let run = try runBoot(seq)
        XCTAssertTrue(run.bytecodes.isEmpty, "the .qbc is unsigned — NF-35")
        XCTAssertEqual(run.sources, ["app()"])
    }

    func testBootDisabledUsesBytecodeFastPathWhenHashMatches() throws {
        let blob = Data("qbc".utf8)
        storeRecord(
            OTARecord(
                js: "app()", version: nil, signature: nil, bytecodeHash: ContentHash.of(blob)),
            in: active, bytecode: blob)
        let seq = makeSequencer(keyState: .disabled)
        let run = try runBoot(seq)
        XCTAssertEqual(run.bytecodes, [blob])
        XCTAssertTrue(run.sources.isEmpty)
    }

    func testBootHashMismatchParsesSourceInstead() throws {
        storeRecord(
            OTARecord(js: "app()", version: nil, signature: nil, bytecodeHash: "not-it"),
            in: active, bytecode: Data("qbc".utf8))
        let seq = makeSequencer(keyState: .disabled)
        let run = try runBoot(seq)
        XCTAssertTrue(run.bytecodes.isEmpty)
        XCTAssertEqual(run.sources, ["app()"])
    }

    func testBootStaleBytecodeFallsBackToSourceAndClearsCache() throws {
        let blob = Data("qbc".utf8)
        storeRecord(
            OTARecord(
                js: "app()", version: nil, signature: nil, bytecodeHash: ContentHash.of(blob)),
            in: active, bytecode: blob)
        let seq = makeSequencer(keyState: .disabled)
        let run = try runBoot(seq, bytecodeThrows: true)
        XCTAssertEqual(run.bytecodes, [blob])
        XCTAssertEqual(run.sources, ["app()"], "engine-version-stale cache falls back")
        XCTAssertNil(active.bytecode)
        if case .ranOTA = run.outcome {} else { XCTFail("source fallback still boots OTA") }
    }

    func testBootOTAEvalFailureFallsBackToShippedWithNotice() throws {
        storeRecord(signedRecord(), in: active)
        let seq = makeSequencer()
        let run = try runBoot(seq, sourceThrows: true)
        guard case .ranShipped(let notice) = run.outcome else {
            return XCTFail("expected shipped fallback")
        }
        XCTAssertTrue(notice?.contains("using shipped bundle") == true)
        XCTAssertNil(active.record, "a failed candidate is dropped")
        XCTAssertEqual(counters.attempts, 0)
        XCTAssertEqual(run.shipped, 1)
    }

    func testBootEnforcedReVerifyFailureDropsPlantedRecord() throws {
        // An App-Group writer plants a record with a bad signature (NF-35).
        storeRecord(
            OTARecord(js: "evil()", keyId: "k1", version: 2, signature: "ZXZpbA=="),
            in: active)
        let seq = makeSequencer()
        let run = try runBoot(seq)
        XCTAssertTrue(run.sources.isEmpty, "unverified source must never run")
        guard case .ranShipped(let notice) = run.outcome else {
            return XCTFail("expected shipped fallback")
        }
        XCTAssertTrue(notice?.contains("re-verification") == true)
        XCTAssertNil(active.record)
    }

    func testBootUnconfiguredKeepsCandidateAndRunsShipped() throws {
        storeRecord(signedRecord(), in: active)
        let seq = makeSequencer(keyState: .unconfigured)
        let run = try runBoot(seq)
        XCTAssertEqual(run.outcome, .ranShipped(notice: nil))
        XCTAssertTrue(run.sources.isEmpty)
        XCTAssertNotNil(
            active.record,
            "kept, not dropped: fixing the key config re-verifies and runs it")
    }

    func testBootHardGateBlocksStaleShipped() throws {
        counters.highWater = 5
        let seq = makeSequencer(gate: .hard, shippedVersion: 1)
        let run = try runBoot(seq)
        XCTAssertEqual(run.outcome, .blockForUpdate(notice: nil))
        XCTAssertEqual(run.shipped, 0, "stale JS must not touch the db")
    }

    func testBootFailedCandidateReRunsPolicyAndHardGateBlocks() throws {
        // The candidate satisfies the gate, but fails to eval; with it gone the
        // shipped bundle is below the high-water mark — the re-decision must
        // block, or a tampered candidate would smuggle stale JS past CR-17.
        counters.highWater = 5
        storeRecord(signedRecord(version: 5), in: active)
        let seq = makeSequencer(gate: .hard, shippedVersion: 1)
        let run = try runBoot(seq, sourceThrows: true)
        guard case .blockForUpdate(let notice) = run.outcome else {
            return XCTFail("expected block, got \(run.outcome)")
        }
        XCTAssertNotNil(notice)
        XCTAssertEqual(run.shipped, 0)
    }

    // MARK: - Crash-loop recovery

    func testCrashLoopRollsBackToKnownGood() throws {
        storeRecord(signedRecord(js: "bad()", version: 3), in: active)
        let goodBlob = Data("good-qbc".utf8)
        let good = signedRecord(js: "good()", version: 2, bytecodeHash: ContentHash.of(goodBlob))
        storeRecord(good, in: knownGood, bytecode: goodBlob)
        counters.attempts = 3
        counters.highWater = 2
        let seq = makeSequencer()
        let run = try runBoot(seq)
        guard case .ranOTA(let record, let notice) = run.outcome else {
            return XCTFail("expected rollback boot")
        }
        XCTAssertEqual(record, good)
        XCTAssertTrue(notice?.contains("rolled back") == true)
        XCTAssertEqual(
            counters.attempts, 1,
            "the restored bundle gets ONE attempt; a second loop drops to shipped")
        XCTAssertEqual(decodeActiveRecord(), good, "snapshot restored as active")
        XCTAssertEqual(active.bytecode, goodBlob, "bytecode restored alongside")
    }

    func testCrashLoopKnownGoodMatchingActiveDropsToShipped() throws {
        // The snapshot IS the bundle that crash-looped (promoted healthy once,
        // then an OS update broke it) — restoring it would loop forever.
        let record = signedRecord(version: 2)
        storeRecord(record, in: active)
        storeRecord(record, in: knownGood)
        counters.attempts = 3
        let seq = makeSequencer()
        let run = try runBoot(seq)
        guard case .ranShipped(let notice) = run.outcome else {
            return XCTFail("expected shipped")
        }
        XCTAssertTrue(notice?.contains("rolled back") == true)
        XCTAssertNil(active.record)
        XCTAssertNil(knownGood.record)
        XCTAssertEqual(counters.attempts, 0)
    }

    func testCrashLoopWithNoKnownGoodDropsToShipped() throws {
        storeRecord(signedRecord(), in: active, bytecode: Data("qbc".utf8))
        counters.attempts = 3
        let seq = makeSequencer()
        let run = try runBoot(seq)
        guard case .ranShipped = run.outcome else { return XCTFail("expected shipped") }
        XCTAssertNil(active.record)
        XCTAssertNil(active.bytecode)
    }

    func testCrashLoopRollbackEvalFailureDropsEverything() throws {
        storeRecord(signedRecord(js: "bad()", version: 3), in: active)
        storeRecord(signedRecord(js: "good()", version: 2), in: knownGood)
        counters.attempts = 3
        counters.highWater = 2
        let seq = makeSequencer()
        let run = try runBoot(seq, sourceThrows: true)
        guard case .ranShipped(let notice) = run.outcome else {
            return XCTFail("expected shipped")
        }
        XCTAssertTrue(notice?.contains("rollback bundle also failed") == true)
        XCTAssertNil(active.record)
        XCTAssertNil(knownGood.record)
        XCTAssertEqual(counters.attempts, 0)
        XCTAssertEqual(run.shipped, 1)
    }

    // MARK: - Healthy-commit promotion

    func testMarkHealthyResetsCounterAndPromotesWithBytecode() {
        let blob = Data("qbc".utf8)
        let record = signedRecord(bytecodeHash: ContentHash.of(blob))
        storeRecord(record, in: active, bytecode: blob)
        counters.attempts = 1
        makeSequencer().markHealthy(bootedRecord: record)
        XCTAssertEqual(counters.attempts, 0)
        XCTAssertEqual(
            knownGood.record.flatMap { try? JSONDecoder().decode(OTARecord.self, from: $0) },
            record)
        XCTAssertEqual(knownGood.bytecode, blob)
    }

    func testMarkHealthyIsANoOpOnceAttemptsAreZero() {
        counters.attempts = 0
        knownGood.record = Data("sentinel".utf8)
        makeSequencer().markHealthy(bootedRecord: signedRecord())
        XCTAssertEqual(knownGood.record, Data("sentinel".utf8), "no churn after the first reset")
    }

    func testMarkHealthyRunningShippedResetsWithoutPromoting() {
        counters.attempts = 2
        makeSequencer().markHealthy(bootedRecord: nil)
        XCTAssertEqual(counters.attempts, 0)
        XCTAssertNil(knownGood.record)
    }
}

extension OTABootSequencerTests {
    func testShippedFailureAfterOTADropStillCarriesTheNotice() {
        // Double failure: the candidate is dropped (bad signature), THEN the
        // shipped bundle also fails to load. The throw must carry the OTA
        // notice — losing it would leave only the shipped error, hiding WHY
        // the OTA isn't running.
        storeRecord(
            OTARecord(js: "evil()", keyId: "k1", version: 2, signature: "ZXZpbA=="),
            in: active)
        struct ShippedBoom: Error {}
        let seq = makeSequencer()
        XCTAssertThrowsError(
            try seq.boot(
                evalSource: { _ in },
                evalBytecode: { _, _ in },
                evalShipped: { throw ShippedBoom() }
            )
        ) { error in
            guard let failure = error as? OTABootSequencer.BootFailure else {
                return XCTFail("expected BootFailure, got \(error)")
            }
            XCTAssertTrue(
                failure.notice?.contains("re-verification") == true,
                "notice lost: \(failure.notice ?? "nil")")
            XCTAssertTrue(failure.underlying is ShippedBoom)
        }
    }
}

// The revocation lever (scheme v2): a signed expiry is enforced at save AND at
// every boot, and can't be stripped (it's inside the signed bytes — pinned by
// OTASigningInteropTests/UpdatePlanTests; these cover the enforcement).
extension OTABootSequencerTests {
    func testStageRejectsALapsedSignedExpiry() {
        let seq = makeSequencer()
        guard
            case .rejected(let reason) = seq.stage(
                signedPayload(expiresAt: 999_999))
        else {
            return XCTFail("expected rejection")
        }
        XCTAssertTrue(reason.contains("expired"), "got: \(reason)")
        XCTAssertNil(active.record)
    }

    func testStageAcceptsAFutureExpiryAndPersistsIt() {
        let seq = makeSequencer()
        XCTAssertEqual(seq.stage(signedPayload(expiresAt: 2_000_000)), .accepted)
        XCTAssertEqual(decodeActiveRecord()?.expiresAt, 2_000_000)
    }

    func testBootDropsARecordWhoseExpiryLapsedOnDevice() throws {
        // Accepted while valid, expired by the next launch: the boot
        // re-verification is where the revocation actually lands.
        storeRecord(signedRecord(expiresAt: 999_999), in: active)
        let seq = makeSequencer()
        let run = try runBoot(seq)
        XCTAssertTrue(run.sources.isEmpty, "a lapsed bundle must not run")
        guard case .ranShipped(let notice) = run.outcome else {
            return XCTFail("expected shipped fallback")
        }
        XCTAssertTrue(notice?.contains("expiry has lapsed") == true)
        XCTAssertNil(active.record)
    }

    func testZeroOrAbsentExpiryNeverLapses() throws {
        storeRecord(signedRecord(expiresAt: 0), in: active)
        let seq = makeSequencer()
        let run = try runBoot(seq)
        if case .ranOTA = run.outcome {
        } else {
            XCTFail("expiresAt 0 must mean never, got \(run.outcome)")
        }
    }
}
