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
}
