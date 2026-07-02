import Foundation
import ReactWatchCore
import ReactWatchSupport
import XCTest

/// Unit tests for the platform-support logic extracted from the SwiftUI host —
/// the optimistic-controls bookkeeping and the notification trigger math, the
/// parts with real edge cases. These ran "unverified until a Mac" while inline
/// in ReactWatchHost; now they're checked on Linux.
final class OptimisticStoreTests: XCTestCase {
    func testHoldsValuesByKindUntilAcked() {
        var store = OptimisticStore()
        XCTAssertTrue(store.isEmpty)

        store.set(nodeId: 1, seq: 5, value: .bool(true))
        store.set(nodeId: 2, seq: 6, value: .number(42))
        store.set(nodeId: 3, seq: 7, value: .string("draft"))  // CR-3: TextField
        XCTAssertEqual(store.bool(1), true)
        XCTAssertEqual(store.int(2), 42)
        XCTAssertEqual(store.double(2), 42)
        XCTAssertEqual(store.string(3), "draft")
        XCTAssertNil(store.bool(2))  // wrong kind -> nil
        XCTAssertNil(store.string(1))  // wrong kind -> nil
        XCTAssertNil(store.int(99))  // unknown id -> nil
    }

    func testAckDropsOnlyCaughtUpEntries() {
        var store = OptimisticStore()
        store.set(nodeId: 1, seq: 5, value: .bool(true))
        store.set(nodeId: 2, seq: 8, value: .bool(false))

        // A commit that acks through seq 5 clears node 1 but not the newer node 2.
        store.ack(throughSeq: 5)
        XCTAssertNil(store.bool(1))
        XCTAssertEqual(store.bool(2), false)

        store.ack(throughSeq: 8)
        XCTAssertTrue(store.isEmpty)
    }
}

final class NotificationPlanTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    func testRelativeAfterMs() throws {
        let plan = try XCTUnwrap(
            NotificationPlan(
                json: #"{"id":"a","title":"T","body":"B","afterMs":30000,"sound":true}"#,
                now: now
            ))
        XCTAssertEqual(plan.id, "a")
        XCTAssertTrue(plan.sound)
        XCTAssertEqual(plan.triggerSeconds, 30, accuracy: 0.001)
        XCTAssertFalse(plan.scheduledInPast)
    }

    func testAbsoluteAtWinsOverAfterMs() throws {
        let at = (now.timeIntervalSince1970 + 60) * 1000
        let plan = try XCTUnwrap(
            NotificationPlan(
                json:
                    #"{"id":"b","title":"T","body":"B","at":\#(at),"afterMs":5000,"sound":false}"#,
                now: now
            ))
        XCTAssertEqual(plan.triggerSeconds, 60, accuracy: 0.001)
    }

    func testPastTimeClampsToOneSecondAndFlags() throws {
        let at = (now.timeIntervalSince1970 - 120) * 1000
        let plan = try XCTUnwrap(
            NotificationPlan(
                json: #"{"id":"c","title":"T","body":"B","at":\#(at),"sound":false}"#,
                now: now
            ))
        XCTAssertTrue(plan.scheduledInPast)
        XCTAssertEqual(plan.triggerSeconds, 1)  // never silently in the past
    }

    func testBadPayloadReturnsNil() {
        XCTAssertNil(NotificationPlan(json: "not json", now: now))
        XCTAssertNil(NotificationPlan(json: #"{"id":"x"}"#, now: now))  // missing fields
    }
}

final class RouteMatcherTests: XCTestCase {
    func testLiteralRouteMatchesExactly() {
        XCTAssertEqual(RouteMatcher.match(pattern: "/lists", route: "/lists")?.params, [:])
        XCTAssertNil(RouteMatcher.match(pattern: "/lists", route: "/list"))
        XCTAssertNil(RouteMatcher.match(pattern: "/lists", route: "/lists/1"))
    }

    func testCapturesSingleParam() {
        XCTAssertEqual(
            RouteMatcher.match(pattern: "/list/[id]", route: "/list/42")?.params,
            ["id": ["42"]]
        )
        // [id] is one segment, not a catch-all.
        XCTAssertNil(RouteMatcher.match(pattern: "/list/[id]", route: "/list/42/items"))
        XCTAssertNil(RouteMatcher.match(pattern: "/list/[id]", route: "/list"))
    }

    func testRequiredCatchAllNeedsAtLeastOneSegment() {
        XCTAssertEqual(
            RouteMatcher.match(pattern: "/shop/[name]/[...rest]", route: "/shop/nike/a/b")?
                .params,
            ["name": ["nike"], "rest": ["a", "b"]]
        )
        XCTAssertNil(RouteMatcher.match(pattern: "/shop/[name]/[...rest]", route: "/shop/nike"))
    }

    func testOptionalCatchAllMatchesZeroSegments() {
        XCTAssertEqual(
            RouteMatcher.match(pattern: "/shop/[name]/[[...rest]]", route: "/shop/nike")?
                .params,
            ["name": ["nike"], "rest": []]
        )
        XCTAssertEqual(
            RouteMatcher.match(
                pattern: "/shop/[name]/[[...rest]]", route: "/shop/nike/shoes/running"
            )?
            .params,
            ["name": ["nike"], "rest": ["shoes", "running"]]
        )
    }

    func testBestPicksMostSpecificMatch() {
        // Both patterns match /shop/nike; the concrete one must win.
        let winner = RouteMatcher.best(
            patterns: ["/shop/[name]/[[...rest]]", "/shop/[name]"],
            route: "/shop/nike"
        )
        XCTAssertEqual(winner?.pattern, "/shop/[name]")
        XCTAssertNil(RouteMatcher.best(patterns: ["/list/[id]"], route: "/other"))
    }
}

// CR-10: the BLE bridge keyed characteristics by the raw string, so a write/
// subscribe by the full 128-bit UUID missed one CoreBluetooth stored in short
// form. canonical() collapses every form to one key.
final class BluetoothUUIDTests: XCTestCase {
    private let hrm = "00002A37-0000-1000-8000-00805F9B34FB"  // heart-rate measurement

    func testShortAndLongFormsCollide() {
        XCTAssertEqual(BluetoothUUID.canonical("2A37"), hrm)
        XCTAssertEqual(BluetoothUUID.canonical("2a37"), hrm)  // case-insensitive
        XCTAssertEqual(BluetoothUUID.canonical(hrm.lowercased()), hrm)
        XCTAssertEqual(BluetoothUUID.canonical(hrm), hrm)
    }

    func testThirtyTwoBitShortExpands() {
        XCTAssertEqual(
            BluetoothUUID.canonical("12345678"),
            "12345678-0000-1000-8000-00805F9B34FB"
        )
    }

    func testCustom128BitNormalizesCase() {
        XCTAssertEqual(
            BluetoothUUID.canonical("1234abcd-0000-1000-8000-00805f9b0000"),
            "1234ABCD-0000-1000-8000-00805F9B0000"
        )
    }

    func testRejectsMalformed() {
        XCTAssertNil(BluetoothUUID.canonical(""))  // empty
        XCTAssertNil(BluetoothUUID.canonical("XYZ"))  // non-hex
        XCTAssertNil(BluetoothUUID.canonical("2A3"))  // 3 hex: not 4/8/32
        // 32 hex but not in dashed 8-4-4-4-12 form (CBUUID wouldn't accept it).
        XCTAssertNil(
            BluetoothUUID.canonical(
                hrm.replacingOccurrences(of: "-", with: "")
            ))
    }
}

// CR-4: the saveUpdate payload parsing — the bundle text and its optional
// base64 Ed25519 signature — is pure, so it's tested here; the host does the
// CryptoKit verify with the configured key.
final class UpdatePlanTests: XCTestCase {
    func testParsesSignedPayload() {
        let sig = Data([1, 2, 3, 4])
        let payload =
            #"{"js":"globalThis.x=1","keyId":"abc123","version":4,"signature":"\#(sig.base64EncodedString())"}"#
        let plan = UpdatePlan(payload: payload)
        XCTAssertEqual(plan.js, "globalThis.x=1")
        XCTAssertEqual(plan.keyId, "abc123")
        XCTAssertEqual(plan.version, 4)
        XCTAssertEqual(plan.signature, sig)
    }

    func testUnsignedObjectHasNoVersionOrSignature() {
        let plan = UpdatePlan(payload: #"{"js":"globalThis.x=1"}"#)
        XCTAssertEqual(plan.js, "globalThis.x=1")
        XCTAssertNil(plan.keyId)
        XCTAssertNil(plan.version)
        XCTAssertNil(plan.signature)
    }

    func testBarePayloadIsTreatedAsUnsignedBundle() {
        // A non-JSON payload (legacy/direct caller) is the bundle itself.
        let plan = UpdatePlan(payload: "globalThis.x=1")
        XCTAssertEqual(plan.js, "globalThis.x=1")
        XCTAssertNil(plan.version)
        XCTAssertNil(plan.signature)
    }

    func testParsesCapabilityRequirements() {
        let payload =
            #"{"js":"x","version":2,"requiredFeatures":["network","bluetooth"],"minBridgeProtocol":3}"#
        let plan = UpdatePlan(payload: payload)
        XCTAssertEqual(plan.requiredFeatures, ["network", "bluetooth"])
        XCTAssertEqual(plan.minBridgeProtocol, 3)
    }

    func testCapabilityRequirementsDefaultToEmpty() {
        let plan = UpdatePlan(payload: #"{"js":"x"}"#)
        XCTAssertEqual(plan.requiredFeatures, [])
        XCTAssertEqual(plan.minBridgeProtocol, 0)
    }

    func testSignedMessageBindsSchemeKeyIdVersionAndBundle() {
        // The keyId and version are inside the signed bytes (CX-007), so neither
        // can be relabelled.
        let plan = UpdatePlan(js: "code", keyId: "abc123", version: 7, signature: nil)
        XCTAssertEqual(plan.signedMessage(), Data("v1:abc123:7:code".utf8))
        // No version -> nothing to verify.
        XCTAssertNil(
            UpdatePlan(js: "code", keyId: "abc123", version: nil, signature: nil)
                .signedMessage())
        // No keyId -> nothing to verify (host fails closed when keys configured).
        XCTAssertNil(
            UpdatePlan(js: "code", keyId: nil, version: 7, signature: nil).signedMessage())
        // A keyId with a colon would make the `:`-delimited message ambiguous —
        // rejected, so the concatenation stays injective.
        XCTAssertNil(
            UpdatePlan(js: "code", keyId: "a:1", version: 7, signature: nil).signedMessage())
    }

    func testIsValidKeyId() {
        XCTAssertTrue(UpdatePlan.isValidKeyId("k1A2b3C4"))
        XCTAssertTrue(UpdatePlan.isValidKeyId("a-b_C9"))
        XCTAssertFalse(UpdatePlan.isValidKeyId(""))
        XCTAssertFalse(UpdatePlan.isValidKeyId("has:colon"))
        XCTAssertFalse(UpdatePlan.isValidKeyId("has space"))
        XCTAssertFalse(UpdatePlan.isValidKeyId(String(repeating: "a", count: 65)))
    }
}

// CR-17: anti-rollback + stale-state boot decisions. The version is a
// compatibility integer bumped only on a breaking change, so an older bundle is
// refused and can never run against a newer-schema db.
final class VersionPolicyTests: XCTestCase {
    func testAcceptsEqualOrNewerRejectsOlder() {
        XCTAssertTrue(VersionPolicy.accepts(incoming: 3, highWater: 3))  // non-breaking re-apply
        XCTAssertTrue(VersionPolicy.accepts(incoming: 4, highWater: 3))
        XCTAssertFalse(VersionPolicy.accepts(incoming: 2, highWater: 3))  // downgrade attack
    }

    func testRunsOTAWhenCurrent() {
        XCTAssertEqual(
            VersionPolicy.decide(otaVersion: 5, highWater: 5, shippedVersion: 3, gate: .soft),
            .runOTA
        )
    }

    func testFallsBackToShippedWhenNoOTA() {
        XCTAssertEqual(
            VersionPolicy.decide(otaVersion: nil, highWater: 3, shippedVersion: 3, gate: .hard),
            .runShipped
        )
    }

    func testStaleShippedSoftRunsHardBlocks() {
        // We once ran v5 (highWater) but only a v3 shipped bundle is available.
        XCTAssertEqual(
            VersionPolicy.decide(otaVersion: nil, highWater: 5, shippedVersion: 3, gate: .soft),
            .runShipped
        )
        XCTAssertEqual(
            VersionPolicy.decide(otaVersion: nil, highWater: 5, shippedVersion: 3, gate: .hard),
            .blockForUpdate
        )
    }

    func testRejectedDowngradeOTAIsNotRun() {
        // A persisted OTA below high-water (e.g. replayed old bundle) is ignored;
        // shipped decides.
        XCTAssertEqual(
            VersionPolicy.decide(otaVersion: 2, highWater: 5, shippedVersion: 6, gate: .hard),
            .runShipped
        )
    }

    func testHighWaterIsMonotonic() {
        XCTAssertEqual(VersionPolicy.bumpedHighWater(5, booted: 7), 7)
        XCTAssertEqual(VersionPolicy.bumpedHighWater(7, booted: 5), 7)  // never decreases
    }

    // ARCH-04: crash-loop recovery prefers a previously-healthy OTA over shipped,
    // but never one that would break anti-rollback.
    func testNoKnownGoodDropsToShipped() {
        XCTAssertEqual(
            VersionPolicy.crashLoopRecovery(
                hasKnownGood: false, knownGoodMatchesActive: false,
                knownGoodVersion: nil, highWater: 5, shippedVersion: 3,
                gate: .hard, enforcing: true),
            .dropToShipped
        )
    }

    func testRollsBackToSameVersionKnownGood() {
        // The common case: a non-breaking fix (same version, CX-025 releaseId)
        // crash-loops → roll back to the previous healthy build, not shipped.
        XCTAssertEqual(
            VersionPolicy.crashLoopRecovery(
                hasKnownGood: true, knownGoodMatchesActive: false,
                knownGoodVersion: 5, highWater: 5, shippedVersion: 3,
                gate: .hard, enforcing: true),
            .rollBackToKnownGood
        )
    }

    func testDoesNotRollBackToAnAntiRollbackViolatingKnownGood() {
        // The failing bundle was a newer SCHEMA (v6, now the high-water); the
        // known-good is v5 — running it over the v6 db is exactly what
        // anti-rollback forbids, so drop to shipped (the hard gate then applies).
        XCTAssertEqual(
            VersionPolicy.crashLoopRecovery(
                hasKnownGood: true, knownGoodMatchesActive: false,
                knownGoodVersion: 5, highWater: 6, shippedVersion: 3,
                gate: .hard, enforcing: true),
            .dropToShipped
        )
    }

    func testKnownGoodMatchingTheFailingBundleDropsToShipped() {
        // The snapshot IS the bundle that just crash-looped (promoted healthy
        // once, later broke) — rolling back to it would loop.
        XCTAssertEqual(
            VersionPolicy.crashLoopRecovery(
                hasKnownGood: true, knownGoodMatchesActive: true,
                knownGoodVersion: 5, highWater: 5, shippedVersion: 3,
                gate: .hard, enforcing: true),
            .dropToShipped
        )
    }

    func testFailOpenRollsBackWithoutAVersionGate() {
        // No keys configured → versions unverified, no anti-rollback; any
        // differing known-good is a valid restore target.
        XCTAssertEqual(
            VersionPolicy.crashLoopRecovery(
                hasKnownGood: true, knownGoodMatchesActive: false,
                knownGoodVersion: nil, highWater: 0, shippedVersion: 1,
                gate: .soft, enforcing: false),
            .rollBackToKnownGood
        )
    }
}

// CR-15: the BLE bridge's connection bookkeeping (the write-replay queue, the
// re-applied subscriptions, the deliberate-vs-dropped disconnect latch) is the
// state that rots silently. Pulled into BleSession so it's tested off-device.
final class BleSessionTests: XCTestCase {
    func testPendingWritesReplayInOrderThenClear() {
        var s = BleSession()
        s.queueWrite(characteristic: "A", value: "1", confirm: nil)
        s.queueWrite(characteristic: "B", value: "2", confirm: true)

        XCTAssertEqual(
            s.takePendingWrites(),
            [
                .init(characteristic: "A", value: "1", confirm: nil),
                .init(characteristic: "B", value: "2", confirm: true),
            ])
        // Taken exactly once — discovery must not replay the same writes twice.
        XCTAssertTrue(s.pendingWrites.isEmpty)
        XCTAssertTrue(s.takePendingWrites().isEmpty)
    }

    func testSubscriptionsPersistForReapplyAcrossADrop() {
        var s = BleSession()
        s.beginConnect()
        s.wantSubscription("HR")
        s.wantSubscription("HR")  // de-duped (Set)
        s.wantSubscription("BAT")
        // An unexpected drop leaves the session untouched, so the desired set
        // remains to re-apply on the auto-reconnect.
        XCTAssertEqual(s.desiredSubscriptions, ["HR", "BAT"])
        XCTAssertTrue(s.shouldAutoReconnect)
    }

    func testUserDisconnectDropsEverythingAndStaysDown() {
        var s = BleSession()
        s.beginConnect()
        s.wantSubscription("HR")
        s.queueWrite(characteristic: "CMD", value: "play", confirm: nil)

        s.endByUser()
        XCTAssertTrue(s.desiredSubscriptions.isEmpty)
        // A deliberate disconnect must not resurrect a stale write on reconnect.
        XCTAssertTrue(s.pendingWrites.isEmpty)
        XCTAssertFalse(s.shouldAutoReconnect)  // stays down, no auto-reconnect

        s.beginConnect()  // a fresh connect re-arms auto-reconnect
        XCTAssertTrue(s.shouldAutoReconnect)
    }

    // CX-022: the invoke-result correlation. These pin the part that has to be
    // right before the device half can be trusted — connect settling exactly
    // once across an auto-reconnect, write acks correlating FIFO per
    // characteristic, and nothing left hanging on teardown.
    func testConnectSettlesOnceThenAutoReconnectDoesNotResettle() {
        var s = BleSession()
        XCTAssertNil(s.awaitConnect(id: 7))  // nothing was pending
        // First didConnect resolves invoke 7…
        XCTAssertEqual(s.takeConnectSettle(), 7)
        // …and a later auto-reconnect's didConnect finds nothing — no double-settle.
        XCTAssertNil(s.takeConnectSettle())
    }

    func testReentrantConnectSurrendersTheStaleId() {
        var s = BleSession()
        XCTAssertNil(s.awaitConnect(id: 1))
        // A second bleConnect before the first settled hands back id 1 to reject,
        // and id 2 becomes the one in flight.
        XCTAssertEqual(s.awaitConnect(id: 2), 1)
        XCTAssertEqual(s.takeConnectSettle(), 2)
    }

    func testWriteAcksCorrelateFIFOPerCharacteristic() {
        var s = BleSession()
        s.awaitWriteAck(characteristic: "CMD", id: 10)
        s.awaitWriteAck(characteristic: "CMD", id: 11)
        s.awaitWriteAck(characteristic: "VOL", id: 12)
        // didWriteValueFor only carries the characteristic, so same-char acks
        // settle oldest-first; a different char is independent.
        XCTAssertEqual(s.takeWriteAck(characteristic: "CMD"), 10)
        XCTAssertEqual(s.takeWriteAck(characteristic: "VOL"), 12)
        XCTAssertEqual(s.takeWriteAck(characteristic: "CMD"), 11)
        // Nothing left → an unexpected didWriteValueFor settles nobody.
        XCTAssertNil(s.takeWriteAck(characteristic: "CMD"))
        XCTAssertNil(s.takeWriteAck(characteristic: "VOL"))
    }

    func testSubscribeSettlesPerCharacteristicAndResubscribeSurrenders() {
        var s = BleSession()
        XCTAssertNil(s.awaitSubscribe(characteristic: "HR", id: 20))
        XCTAssertNil(s.awaitSubscribe(characteristic: "BAT", id: 21))
        // Re-subscribing HR before it settled hands back 20 to reject.
        XCTAssertEqual(s.awaitSubscribe(characteristic: "HR", id: 22), 20)
        XCTAssertEqual(s.takeSubscribeSettle(characteristic: "HR"), 22)
        XCTAssertEqual(s.takeSubscribeSettle(characteristic: "BAT"), 21)
        XCTAssertNil(s.takeSubscribeSettle(characteristic: "HR"))
    }

    func testTakeAllPendingDrainsEverythingForTeardown() {
        var s = BleSession()
        _ = s.awaitConnect(id: 1)
        s.awaitWriteAck(characteristic: "CMD", id: 2)
        s.awaitWriteAck(characteristic: "CMD", id: 3)
        _ = s.awaitSubscribe(characteristic: "HR", id: 4)
        // A write queued before discovery also carries a promise; a disconnect
        // before discovery must reject it, not leak it (the workflow caught this).
        s.queueWrite(characteristic: "X", value: "1", confirm: nil, invokeId: 5)

        // A disconnect/drop must settle every in-flight promise, not leave JS
        // awaiting forever.
        XCTAssertEqual(s.takeAllPending().sorted(), [1, 2, 3, 4, 5])
        // Drained: a second teardown has nothing, and the maps + queue are clear.
        XCTAssertTrue(s.takeAllPending().isEmpty)
        XCTAssertTrue(s.pendingWrites.isEmpty)
        XCTAssertNil(s.takeConnectSettle())
        XCTAssertNil(s.takeWriteAck(characteristic: "CMD"))
        XCTAssertNil(s.takeSubscribeSettle(characteristic: "HR"))
    }
}

// ARCH-01: the capability gate decides whether an OTA bundle may run on this
// binary. The point is that the same bundle can be accepted by one target and
// rejected by another (the widget provides a strict subset), so the gate is a
// set-subset test, not a scalar version compare.
final class CapabilityGateTests: XCTestCase {
    func testWidgetProvidesAStrictSubset() {
        XCTAssertEqual(HostFeatures.widget, ["core", "storage", "widgets"])
        XCTAssertTrue(HostFeatures.widget.isSubset(of: HostFeatures.watch))
    }

    func testAcceptsWhenFeaturesSubsetAndProtocolCompatible() {
        XCTAssertEqual(
            CapabilityGate.decide(
                bundleBridgeProtocol: 1,
                bundleFeatures: ["storage", "network"],
                nativeBridgeProtocol: 1,
                nativeFeatures: HostFeatures.watch
            ),
            .accept
        )
    }

    func testRejectsWhenAFeatureIsMissing() {
        // A bundle using fetch ("network") can't run in the widget target.
        XCTAssertEqual(
            CapabilityGate.decide(
                bundleBridgeProtocol: 1,
                bundleFeatures: ["storage", "network"],
                nativeBridgeProtocol: 1,
                nativeFeatures: HostFeatures.widget
            ),
            .updateAppRequired(missing: ["network"])
        )
    }

    func testRejectsWhenBundleNeedsANewerBridgeProtocol() {
        XCTAssertFalse(
            CapabilityGate.accepts(
                bundleBridgeProtocol: 2,
                bundleFeatures: ["storage"],
                nativeBridgeProtocol: 1,
                nativeFeatures: HostFeatures.watch
            )
        )
    }
}

/// SD-2 / CX-018: the styling logic shared by both interpreters lives here so it
/// can't drift. These pin the behaviors the widget had lost (hex colors) and the
/// formatting both sides must agree on.
final class RNStyleTests: XCTestCase {
    func testNamedColor() {
        XCTAssertEqual(RNStyle.color("green"), .named("green"))
    }

    func testHexColor6And8Digits() {
        XCTAssertEqual(
            RNStyle.color("#FF8000"), .rgba(r: 1, g: 128.0 / 255, b: 0, a: 1)
        )
        XCTAssertEqual(
            RNStyle.color("#00000080"),
            .rgba(r: 0, g: 0, b: 0, a: 128.0 / 255)
        )
    }

    func testUnknownColorIsNil() {
        XCTAssertNil(RNStyle.color("chartreuse"))
        XCTAssertNil(RNStyle.color("#12"))  // wrong length
        XCTAssertNil(RNStyle.color(nil))
    }

    func testFontStyleParsingFallsBackToBody() {
        XCTAssertEqual(RNStyle.fontStyle("title2"), .title2)
        XCTAssertEqual(RNStyle.fontStyle("nonsense"), .body)
        XCTAssertEqual(RNStyle.fontStyle(nil), .body)
    }

    func testFormatValueIntegerVsDecimal() {
        XCTAssertEqual(RNStyle.formatValue(3), "3")
        XCTAssertEqual(RNStyle.formatValue(3.5), "3.5")
    }

    func testFormatTimer() {
        XCTAssertEqual(RNStyle.formatTimer(0), "00:00.000")
        XCTAssertEqual(RNStyle.formatTimer(65.25), "01:05.250")
    }
}

// CX-016: snapshots must show the entry applicable *now*, not the last
// (future-dated) one.
final class WidgetSnapshotTests: XCTestCase {
    private func date(_ s: TimeInterval) -> Date {
        Date(timeIntervalSince1970: s)
    }

    func testPicksLatestEntryAtOrBeforeNow() {
        let dates = [date(0), date(100), date(200), date(300)]
        // now = 250 → the 200 entry (index 2), not the future 300 (.last).
        XCTAssertEqual(
            WidgetSnapshot.currentIndex(dates: dates, now: date(250)), 2
        )
    }

    func testAllFuturePicksEarliest() {
        let dates = [date(300), date(100), date(200)]
        XCTAssertEqual(
            WidgetSnapshot.currentIndex(dates: dates, now: date(50)), 1
        )
    }

    func testExactNowIsIncluded() {
        let dates = [date(100), date(200)]
        XCTAssertEqual(
            WidgetSnapshot.currentIndex(dates: dates, now: date(200)), 1
        )
    }

    func testEmptyIsNil() {
        XCTAssertNil(WidgetSnapshot.currentIndex(dates: [], now: date(0)))
    }
}

// OP-1: the source<->bytecode pairing hash must be deterministic across launches
// (so a stale .qbc is detected) and differ for different sources.
final class ContentHashTests: XCTestCase {
    func testDeterministicAndDistinct() {
        XCTAssertEqual(
            ContentHash.of("globalThis.x=1"), ContentHash.of("globalThis.x=1")
        )
        XCTAssertNotEqual(
            ContentHash.of("globalThis.x=1"), ContentHash.of("globalThis.x=2")
        )
        XCTAssertFalse(ContentHash.of("").isEmpty)
    }

    // ARCH-04: the Data overload pins an OTA record to its bytecode blob, so a
    // different blob (a stale `.qbc`) must hash differently. Matches the String
    // overload for the same bytes (one FNV-1a core).
    func testDataOverloadDistinctAndMatchesStringForSameBytes() {
        XCTAssertEqual(
            ContentHash.of(Data([1, 2, 3])), ContentHash.of(Data([1, 2, 3]))
        )
        XCTAssertNotEqual(
            ContentHash.of(Data([1, 2, 3])), ContentHash.of(Data([1, 2, 4]))
        )
        XCTAssertEqual(
            ContentHash.of(Data("abc".utf8)), ContentHash.of("abc")
        )
    }
}

/// ARCH-04 atomic apply: the active-bundle record is one Codable unit, so source
/// and version/signature/bytecodeHash always land together — JSON round-trips
/// without losing the optional fields.
final class OTARecordTests: XCTestCase {
    func testRoundTripsAllFields() throws {
        let record = OTARecord(
            js: "globalThis.x=1", keyId: "abc123", version: 7, signature: "sig==",
            bytecodeHash: "abcd"
        )
        let data = try JSONEncoder().encode(record)
        let back = try JSONDecoder().decode(OTARecord.self, from: data)
        XCTAssertEqual(back, record)
        XCTAssertEqual(back.keyId, "abc123")  // CX-007 audit field
    }

    func testRoundTripsUnsignedFailOpen() throws {
        // Fail-open path: no key configured -> nil keyId/version/signature.
        let record = OTARecord(
            js: "x", keyId: nil, version: nil, signature: nil, bytecodeHash: nil)
        let data = try JSONEncoder().encode(record)
        let back = try JSONDecoder().decode(OTARecord.self, from: data)
        XCTAssertEqual(back, record)
        XCTAssertNil(back.keyId)
        XCTAssertNil(back.version)
        XCTAssertNil(back.bytecodeHash)
    }
}

// ARCH-04: the OTA boot-attempt counter (crash-loop guard) and high-water mark
// must round-trip through the App Group. A throwaway suite keeps the real one
// clean; default (unset) reads must be 0 so a fresh install isn't mistaken for
// a crash loop.
final class SharedWidgetStoreTests: XCTestCase {
    private var suite: String!
    private var store: SharedWidgetStore!

    override func setUp() {
        super.setUp()
        suite = "test.react.store.\(UUID().uuidString)"
        store = SharedWidgetStore(appGroupId: suite)
    }

    override func tearDown() {
        UserDefaults().removePersistentDomain(forName: suite)
        super.tearDown()
    }

    func testBootAttemptsDefaultZeroAndRoundTrip() {
        XCTAssertEqual(
            store.otaBootAttempts(), 0,
            "fresh install must not look like a crash loop"
        )
        store.setOTABootAttempts(2)
        XCTAssertEqual(store.otaBootAttempts(), 2)
        store.setOTABootAttempts(0)  // healthy commit resets
        XCTAssertEqual(store.otaBootAttempts(), 0)
    }

    func testHighWaterDefaultZeroAndRoundTrip() {
        XCTAssertEqual(store.otaHighWater(), 0)
        store.setOTAHighWater(7)
        XCTAssertEqual(store.otaHighWater(), 7)
    }

    func testNilAppGroupIsInertNotCrashing() {
        let none = SharedWidgetStore(appGroupId: nil)
        none.setOTABootAttempts(5)  // no-op without a group
        XCTAssertEqual(none.otaBootAttempts(), 0)
    }

    // The save↔load contract the widget extension depends on: the watch app
    // writes React-published timelines with `save`, and the extension's
    // TimelineProviders read them back with `loadPublishedWidgets`. If the
    // decoder drifted from what the app writes, every widget would silently fall
    // back to the placeholder — so pin the round-trip. The package's
    // ReactWatchWidget providers build entirely on this.
    func testLoadPublishedWidgetsRoundTrips() {
        XCTAssertNil(
            store.loadPublishedWidgets(), "an unpublished store has no payload")

        // The exact JSON shape the JS side publishes (js/src/widgets.ts).
        let json = """
            {"v":1,"publishedAt":1000,
             "widgets":{"hydration":{"accessoryCircular":{
               "entries":[{"date":2000,"tree":null,"url":null,"relevance":null}],
               "reloadAfter":null,"relevantContexts":null}}},
             "controls":{"hydration.addGlass":
               {"intent":"addGlass","label":"Add Glass","systemName":"drop.fill"}}}
            """
        store.save(json)

        let loaded = store.loadPublishedWidgets()
        XCTAssertEqual(loaded?.v, 1)
        XCTAssertEqual(
            loaded?.widgets["hydration"]?["accessoryCircular"]?.entries.count, 1)
        XCTAssertEqual(
            loaded?.controls?["hydration.addGlass"]?.label, "Add Glass")
        XCTAssertEqual(
            loaded?.controls?["hydration.addGlass"]?.systemName, "drop.fill")
    }

    func testLoadIgnoresGarbage() {
        store.save("not json")
        XCTAssertNil(store.loadPublishedWidgets(), "undecodable payload is nil")
    }
}

// CX-003: a configured-but-malformed signing key must not silently degrade to
// fail-open. The pure classifier keeps the states distinct; the host wires
// `.misconfigured` to "refuse all OTA loudly" and `.disabled` to fail-open.
final class OTAKeyStateTests: XCTestCase {
    func testNoKeysWithoutOptInIsUnconfigured() {
        // NF-29: the zero-config default is secure — no keys and no explicit
        // opt-in refuses new OTA saves instead of silently loading unsigned.
        XCTAssertEqual(
            OTAKeyState.classify(configuredCount: 0, validCount: 0, allowUnsigned: false),
            .unconfigured)
    }

    func testNoKeysWithOptInIsDisabled() {
        // Dev fail-open requires the explicit allowUnsignedUpdates opt-in.
        XCTAssertEqual(
            OTAKeyState.classify(configuredCount: 0, validCount: 0, allowUnsigned: true),
            .disabled)
    }

    func testOptInIsIgnoredOnceKeysAreConfigured() {
        // Configured keys always enforce; the dev opt-in can't weaken them.
        XCTAssertEqual(
            OTAKeyState.classify(configuredCount: 2, validCount: 2, allowUnsigned: true),
            .enforced)
    }

    func testAllKeysValidEnforces() {
        XCTAssertEqual(
            OTAKeyState.classify(configuredCount: 2, validCount: 2, allowUnsigned: false),
            .enforced)
    }

    func testSomeValidStillEnforces() {
        // A partially-bad keyset still enforces on its valid keys (the bad one is
        // dropped + warned) — only an ALL-bad keyset is misconfigured.
        XCTAssertEqual(
            OTAKeyState.classify(configuredCount: 2, validCount: 1, allowUnsigned: false),
            .enforced)
    }

    func testConfiguredButNoneValidIsMisconfigured() {
        // The CX-003 trap: keys were set (enforcement intended) but every one
        // failed to decode — must be fail-closed, NOT the same as `.disabled`,
        // and the dev opt-in must not soften it either.
        XCTAssertEqual(
            OTAKeyState.classify(configuredCount: 1, validCount: 0, allowUnsigned: false),
            .misconfigured)
        XCTAssertEqual(
            OTAKeyState.classify(configuredCount: 1, validCount: 0, allowUnsigned: true),
            .misconfigured)
        XCTAssertNotEqual(
            OTAKeyState.classify(configuredCount: 1, validCount: 0, allowUnsigned: false),
            .disabled)
    }
}

// ARCH-05: the atomic counter that fixes the cross-process lost-update on shared
// state (the hydration counter is written by both the app and the widget
// extension). The clamp is pure; the persist/accumulate path is exercised
// against a temp dir (single-process — the cross-process *atomicity* is the
// NSFileCoordinator guarantee, verified on-device, not here).
final class CoordinatedCounterStoreTests: XCTestCase {
    private func tempStore() -> (CoordinatedCounterStore, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("counter-tests-\(UUID().uuidString)")
        return (CoordinatedCounterStore(directory: dir), dir)
    }

    override func tearDown() {
        // Each test uses a unique dir; nothing global to reset.
        super.tearDown()
    }

    func testUnsetCounterReadsZero() {
        let (store, dir) = tempStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertEqual(store.value(forKey: "hydration.glasses"), 0)
    }

    func testAddAccumulatesAndPersists() {
        let (store, dir) = tempStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertEqual(store.add(1, toKey: "g", min: 0, max: 8), 1)
        XCTAssertEqual(store.add(1, toKey: "g", min: 0, max: 8), 2)
        XCTAssertEqual(store.add(1, toKey: "g", min: 0, max: 8), 3)
        // A fresh store over the same dir reads the persisted value.
        let reread = CoordinatedCounterStore(directory: dir)
        XCTAssertEqual(reread.value(forKey: "g"), 3)
    }

    func testAddClampsAtMax() {
        let (store, dir) = tempStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        for _ in 0..<20 { store.add(1, toKey: "g", min: 0, max: 8) }
        XCTAssertEqual(store.value(forKey: "g"), 8)
    }

    func testNegativeDeltaResetsToFloor() {
        // How the demo's "Reset" works: a large negative delta clamps to min,
        // so there's no separate "set" op on the bridge.
        let (store, dir) = tempStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        store.add(5, toKey: "g", min: 0, max: 8)
        XCTAssertEqual(store.add(-8, toKey: "g", min: 0, max: 8), 0)
    }

    func testKeysAreIsolated() {
        let (store, dir) = tempStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        store.add(3, toKey: "a.b", min: 0, max: 99)
        store.add(7, toKey: "a/b", min: 0, max: 99)  // distinct after encoding
        XCTAssertEqual(store.value(forKey: "a.b"), 3)
        XCTAssertEqual(store.value(forKey: "a/b"), 7)
    }

    func testNoAppGroupIsANoOp() {
        // Sharing disabled (nil container) — ops return the floor, never crash.
        let store = CoordinatedCounterStore(directory: nil)
        XCTAssertEqual(store.value(forKey: "g"), 0)
        XCTAssertEqual(store.add(1, toKey: "g", min: 2, max: 8), 2)
    }
}

/// The widget extension's bundle-selection rule, extracted from the watchOS-only
/// WidgetIntentRuntime so the load-bearing ARCH-04 invariant — render the
/// known-good record, never the unvetted active one — is pinned on Linux.
final class WidgetBundleChoiceTests: XCTestCase {
    private func record(_ js: String, hash: String? = "h") -> OTARecord {
        OTARecord(js: js, version: 1, signature: nil, bytecodeHash: hash)
    }

    func testNoKnownGoodRecordFallsBackToShipped() {
        XCTAssertEqual(
            WidgetBundleChoice.decide(knownGood: nil, bytecodeHashMatches: true),
            .shipped)
    }

    func testEmptyKnownGoodRecordFallsBackToShipped() {
        // A record with no source is unusable — don't run an empty bundle.
        XCTAssertEqual(
            WidgetBundleChoice.decide(
                knownGood: record(""), bytecodeHashMatches: true),
            .shipped)
    }

    func testRunsPinnedBytecodeOnlyWhenHashMatches() {
        XCTAssertEqual(
            WidgetBundleChoice.decide(
                knownGood: record("globalThis.x=1;"), bytecodeHashMatches: true),
            .knownGoodBytecode)
        // Stale/absent bytecode → parse the source, never run unpinned bytecode.
        XCTAssertEqual(
            WidgetBundleChoice.decide(
                knownGood: record("globalThis.x=1;"), bytecodeHashMatches: false),
            .knownGoodSource)
    }

    func testKnownGoodFilesAreDistinctFromTheActiveOnes() {
        // The widget must read the KNOWN-GOOD paths, not the unvetted active
        // ones — a swap would make a crash-looping bundle brick the complication.
        XCTAssertNotEqual(OTAFiles.knownGoodRecord, OTAFiles.activeRecord)
        XCTAssertNotEqual(OTAFiles.knownGoodBytecode, OTAFiles.activeBytecode)
    }
}

// Design-system Tier 1: pure parsing for the layout-modifier props
// (padding/frame), shared by NodeView and WidgetNodeView via RNStyle so the
// two interpreters can't drift (the CX-018 lesson).
final class RNStyleModifierTests: XCTestCase {
    func testScalarPaddingAppliesToAllEdges() {
        XCTAssertEqual(
            RNStyle.padding(from: .number(8)), RNStyle.Insets(all: 8))
    }

    func testObjectPaddingPerAxis() {
        XCTAssertEqual(
            RNStyle.padding(from: .object(["horizontal": .number(8), "vertical": .number(2)])),
            RNStyle.Insets(horizontal: 8, vertical: 2))
        XCTAssertEqual(
            RNStyle.padding(from: .object(["horizontal": .number(6)])),
            RNStyle.Insets(horizontal: 6))
    }

    func testMalformedPaddingIsNil() {
        XCTAssertNil(RNStyle.padding(from: nil))
        XCTAssertNil(RNStyle.padding(from: .string("8")))
        XCTAssertNil(RNStyle.padding(from: .object(["top": .number(1)])))
    }

    func testFrameParsesNumbersAndInfinity() {
        let frame = RNStyle.frame(
            from: .object([
                "width": .number(40), "maxWidth": .string("infinity"),
            ]))
        XCTAssertEqual(frame?.width, 40)
        XCTAssertEqual(frame?.maxWidthInfinity, true)
        XCTAssertNil(frame?.maxWidth)
        XCTAssertNil(frame?.height)
    }

    func testEmptyOrMalformedFrameIsNil() {
        XCTAssertNil(RNStyle.frame(from: nil))
        XCTAssertNil(RNStyle.frame(from: .number(40)))
        XCTAssertNil(RNStyle.frame(from: .object(["width": .string("40")])))
    }
}
