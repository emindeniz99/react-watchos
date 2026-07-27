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

    func testStringArrayHoldsAndReleasesLikeTheScalars() {
        // The controlled NavigationStack's optimistic path — released by the
        // guaranteed seq-ack, so a DECLINED navigation (handler keeps state)
        // snaps native back instead of leaving pendingPath diverged forever.
        var store = OptimisticStore()
        store.set(
            nodeId: 7, seq: 3,
            value: .array([.string("/a"), .string("/b")]))
        XCTAssertEqual(store.stringArray(7), ["/a", "/b"])
        XCTAssertNil(store.string(7))  // wrong kind -> nil
        // A non-string element disqualifies the whole entry.
        store.set(nodeId: 8, seq: 3, value: .array([.string("/a"), .number(1)]))
        XCTAssertNil(store.stringArray(8))
        store.ack(throughSeq: 3)
        XCTAssertNil(store.stringArray(7))
    }
}

// The one way every bridge builds an invoke reject payload — the BLE bridge's
// hand-built version escaped only double quotes, so a backslash or newline in
// a peripheral-supplied message produced invalid errorJson (JS lost the typed
// rejection to a JSON.parse error).
final class InvokeErrorJSONTests: XCTestCase {
    private func decode(_ json: String) throws -> [String: String] {
        try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(json.utf8))
                as? [String: String])
    }

    func testRoundTripsHostileMessages() throws {
        let hostile = "line1\nline2 \\ \"quoted\" \t control\u{1F}"
        let decoded = try decode(
            InvokeErrorJSON.make(code: .unavailable, message: hostile))
        XCTAssertEqual(decoded["code"], "UNAVAILABLE")
        XCTAssertEqual(decoded["message"], hostile)  // exact, not mangled to '
    }

    /// The set is closed at RUNTIME now, not just in the TS type: every code a
    /// bridge can emit is an enum case, and its wire spelling is the exact
    /// string js/src/invoke.ts's `InvokeErrorCode` union lists. This pins the
    /// spellings themselves (a renamed case fails here); the cross-language
    /// set equality — a member added to EITHER side alone — is pinned by
    /// js/test/invoke.test.ts, which reads both sources.
    func testCodeSpellingsMatchTheJSUnion() {
        XCTAssertEqual(
            Set(InvokeErrorCode.allCases.map(\.rawValue)),
            [
                "UNKNOWN_METHOD", "PERMISSION_DENIED", "POLICY_DENIED",
                "UNAVAILABLE", "INVALID_REQUEST", "INTERNAL",
            ])
    }

    func testPlainMessageStaysPlain() throws {
        let decoded = try decode(
            InvokeErrorJSON.make(code: .internal, message: "boom"))
        XCTAssertEqual(decoded, ["code": "INTERNAL", "message": "boom"])
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

final class RemotePushWireTests: XCTestCase {
    func testHexTokenEncodesKnownBytesLowercase() {
        XCTAssertEqual(
            RemotePushWire.hexToken(Data([0xA1, 0xB2, 0x0C, 0x00, 0xFF])),
            "a1b20c00ff")
    }

    func testHexTokenEmptyData() {
        XCTAssertEqual(RemotePushWire.hexToken(Data()), "")
    }

    func testHexTokenLongTokenKeepsEveryByte() {
        // Tokens are variable length — a 32-byte one must render all 64 nibbles.
        let token = Data((0..<32).map { UInt8($0 * 7 % 256) })
        let hex = RemotePushWire.hexToken(token)
        XCTAssertEqual(hex.count, 64)
        XCTAssertEqual(hex.prefix(6), "00070e")
        XCTAssertEqual(hex, hex.lowercased())
    }

    func testSanitizeStringifiesNonStringKeys() {
        let sanitized = RemotePushWire.sanitize([
            AnyHashable("aps"): ["badge": 3],
            AnyHashable(7): "seven",
        ])
        XCTAssertEqual(sanitized["7"] as? String, "seven")
        XCTAssertEqual((sanitized["aps"] as? [String: Any])?["badge"] as? Int, 3)
    }

    func testSanitizePreservesNestedContainers() throws {
        let sanitized = RemotePushWire.sanitize([
            "aps": [
                "alert": ["title": "Hi", "body": "There"],
                "content-available": 1,
            ],
            "tags": ["a", "b"],
            "ok": true,
            "none": NSNull(),
        ])
        let aps = try XCTUnwrap(sanitized["aps"] as? [String: Any])
        let alert = try XCTUnwrap(aps["alert"] as? [String: Any])
        XCTAssertEqual(alert["title"] as? String, "Hi")
        XCTAssertEqual(aps["content-available"] as? Int, 1)
        XCTAssertEqual(sanitized["tags"] as? [String], ["a", "b"])
        XCTAssertEqual(sanitized["ok"] as? Bool, true)
        XCTAssertTrue(sanitized["none"] is NSNull)
        // The whole point: the result must be encodable as-is.
        XCTAssertTrue(JSONSerialization.isValidJSONObject(sanitized))
    }

    func testSanitizeDropsNonJSONValuesIncludingNested() {
        let sanitized = RemotePushWire.sanitize([
            "blob": Data([1, 2, 3]),
            "when": Date(),
            "keep": "yes",
            "nested": ["inner": Data([9]), "n": 2],
            "list": [Date(), "x"] as [Any],
        ])
        // Dropped, not stringified — "<CFData …>" junk must not become a value.
        XCTAssertNil(sanitized["blob"])
        XCTAssertNil(sanitized["when"])
        XCTAssertEqual(sanitized["keep"] as? String, "yes")
        let nested = sanitized["nested"] as? [String: Any]
        XCTAssertNil(nested?["inner"])
        XCTAssertEqual(nested?["n"] as? Int, 2)
        XCTAssertEqual(sanitized["list"] as? [String], ["x"])
        XCTAssertTrue(JSONSerialization.isValidJSONObject(sanitized))
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

    func testMatchesEncodedNonASCIILiteralSegments() {
        // Patterns are authored raw ("/café") but a valid deep link carries
        // the segment percent-encoded — both spellings must match, mirroring
        // js matchRoute.
        XCTAssertNotNil(RouteMatcher.match(pattern: "/café/[id]", route: "/caf%C3%A9/7"))
        XCTAssertNotNil(RouteMatcher.match(pattern: "/café/[id]", route: "/café/7"))
        XCTAssertNil(RouteMatcher.match(pattern: "/café/[id]", route: "/tea/7"))
    }

    func testPercentDecodesCapturedParams() {
        // Parity with js matchRoute: href() percent-encodes substituted params
        // ("a/b" → "a%2Fb" so the value can't change the segment structure);
        // both matchers decode captures so useParams() and the host resolve
        // the SAME values. A malformed escape falls back to the raw text.
        XCTAssertEqual(
            RouteMatcher.match(pattern: "/list/[id]", route: "/list/a%2Fb%20100%25")?
                .params,
            ["id": ["a/b 100%"]]
        )
        XCTAssertEqual(
            RouteMatcher.match(
                pattern: "/shop/[name]/[...rest]", route: "/shop/caf%C3%A9/a%2Fb/c"
            )?.params,
            ["name": ["café"], "rest": ["a/b", "c"]]
        )
        // Malformed escape → raw segment, never a crash or a nil match.
        XCTAssertEqual(
            RouteMatcher.match(pattern: "/list/[id]", route: "/list/%zz")?.params,
            ["id": ["%zz"]]
        )
    }
}

// ARCH-09: the structured `__dispatchEvent` verdict. parse() must map a
// missing/undecodable result — no bundle global, or a thrown JS handler —
// to a rollback, never to an accepted navigation.
final class DispatchResultTests: XCTestCase {
    func testParsesTheBridgeVerdict() {
        let accepted = DispatchResult.parse(#"{"handled":true,"accepted":true}"#)
        XCTAssertTrue(accepted.handled)
        XCTAssertTrue(accepted.accepted)
        XCTAssertNil(accepted.reason)

        let declined = DispatchResult.parse(
            #"{"handled":true,"accepted":false,"reason":"declined"}"#)
        XCTAssertTrue(declined.handled)
        XCTAssertFalse(declined.accepted)
        XCTAssertEqual(declined.reason, "declined")
    }

    func testNilAndGarbageParseToRollback() {
        for json in [nil, "", "not json", "[1,2]"] as [String?] {
            let result = DispatchResult.parse(json)
            XCTAssertFalse(result.handled, "\(json ?? "nil")")
            XCTAssertFalse(result.accepted, "\(json ?? "nil")")
            XCTAssertEqual(result.reason, "no result", "\(json ?? "nil")")
        }
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
        XCTAssertEqual(plan.signedMessage(), Data("v2:abc123:7:0:code".utf8))
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

    // P0-1: bounded auto-reconnect. Without a cap, a peripheral that never
    // re-advertises leaves the central active-scanning forever. These pin the
    // pure attempt accounting; the bridge owns the per-attempt scan-window timer.
    func testReconnectBudgetExhaustsAfterDefaultFiveAttempts() {
        var s = BleSession()
        s.beginConnect()
        for _ in 0..<5 { XCTAssertTrue(s.beginReconnectAttempt()) }
        XCTAssertEqual(s.reconnectAttempts, 5)
        // The sixth is denied → caller stops scanning and goes terminal.
        XCTAssertFalse(s.beginReconnectAttempt())
        XCTAssertFalse(s.canReconnect)
    }

    func testSuccessfulConnectRefreshesTheReconnectBudget() {
        var s = BleSession()
        s.beginConnect()
        _ = s.beginReconnectAttempt()
        _ = s.beginReconnectAttempt()
        XCTAssertEqual(s.reconnectAttempts, 2)
        // A successful connect clears the count so a later drop gets a full budget.
        s.noteConnected()
        XCTAssertEqual(s.reconnectAttempts, 0)
        XCTAssertTrue(s.canReconnect)
    }

    func testConfigureReconnectSetsLimitAndZeroDisablesReconnect() {
        var s = BleSession()
        s.beginConnect()
        s.configureReconnect(maxAttempts: 2)
        XCTAssertTrue(s.beginReconnectAttempt())
        XCTAssertTrue(s.beginReconnectAttempt())
        XCTAssertFalse(s.beginReconnectAttempt())  // capped at 2

        // 0 disables auto-reconnect entirely — not even the first attempt.
        var off = BleSession()
        off.beginConnect()
        off.configureReconnect(maxAttempts: 0)
        XCTAssertFalse(off.canReconnect)
        XCTAssertFalse(off.beginReconnectAttempt())

        // nil leaves the current limit untouched.
        var keep = BleSession()
        keep.configureReconnect(maxAttempts: 3)
        keep.configureReconnect(maxAttempts: nil)
        XCTAssertEqual(keep.maxReconnectAttempts, 3)
    }

    func testUserDisconnectAndFreshConnectResetTheBudget() {
        var s = BleSession()
        s.beginConnect()
        _ = s.beginReconnectAttempt()
        // A deliberate disconnect stops reconnect regardless of remaining budget.
        s.endByUser()
        XCTAssertFalse(s.canReconnect)
        // A fresh connect re-arms it AND resets the spent count.
        s.beginConnect()
        XCTAssertEqual(s.reconnectAttempts, 0)
        XCTAssertTrue(s.canReconnect)
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

// ARCH-07: HostPolicy is the consumer's AUTHORIZATION decision — may a bundle
// use a feature the binary CAN back — kept separate from CapabilityGate
// (compatibility). effectiveFeatures is what actually gets installed/advertised.
final class HostPolicyTests: XCTestCase {
    func testAllowAllPassesTheNativeSetThrough() {
        XCTAssertEqual(
            HostPolicy.allowAll.effectiveFeatures(native: HostFeatures.watch),
            HostFeatures.watch
        )
    }

    func testAllowlistIntersectsWithNative() {
        // Not-native ("teleport") and not-allowed ("network") both drop out.
        XCTAssertEqual(
            HostPolicy.allow(["storage", "teleport"]).effectiveFeatures(
                native: ["core", "storage", "network"]),
            ["core", "storage"]
        )
    }

    func testCoreIsForceKeptEvenWhenNotAllowed() {
        // A policy must not be able to brick commit/log/timers/invoke.
        XCTAssertEqual(
            HostPolicy.allow(["storage"]).effectiveFeatures(
                native: ["core", "storage"]),
            ["core", "storage"]
        )
    }

    func testCoreIsNotInventedWhenNativeLacksIt() {
        XCTAssertEqual(
            HostPolicy.allow(["core", "storage"]).effectiveFeatures(
                native: ["storage"]),
            ["storage"]
        )
    }

    func testAuthorizeAcceptsBundleFeaturesWithinTheEffectiveSet() {
        XCTAssertEqual(
            HostPolicy.allow(["storage", "network"]).authorize(
                bundleFeatures: ["storage", "core"], native: HostFeatures.watch),
            .authorized
        )
    }

    func testAuthorizeDeniesWithTheMissingFeaturesSorted() {
        XCTAssertEqual(
            HostPolicy.allow(["storage"]).authorize(
                bundleFeatures: ["sensors", "network", "storage"],
                native: HostFeatures.watch),
            .denied(byPolicy: ["network", "sensors"])
        )
    }
}

/// SD-2 / CX-018: the styling logic shared by both interpreters lives here so it
/// can't drift. These pin the behaviors the widget had lost (hex colors) and the
/// formatting both sides must agree on.
final class RNStyleTests: XCTestCase {
    func testNamedColor() {
        XCTAssertEqual(RNStyle.color("green"), .named("green"))
        // The theme layer's default accent (Tier 2) must stay resolvable.
        XCTAssertEqual(RNStyle.color("accentColor"), .named("accentColor"))
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

    // M3: every one of these numbers arrives from JS props — adversarial
    // magnitudes must degrade, never trap the app or the widget extension.

    func testClampedIntSaturatesInsteadOfTrapping() {
        XCTAssertEqual(RNStyle.clampedInt(3.9), 3)
        XCTAssertEqual(RNStyle.clampedInt(-3.9), -3)
        XCTAssertEqual(RNStyle.clampedInt(1e300), Int.max)
        XCTAssertEqual(RNStyle.clampedInt(-1e300), Int.min)
        // The exact boundary: Double(Int.max) rounds UP to 2^63, which the
        // plain Int() initializer traps on.
        XCTAssertEqual(RNStyle.clampedInt(0x1p63), Int.max)
        XCTAssertEqual(RNStyle.clampedInt(-0x1p63), Int.min)
        XCTAssertEqual(RNStyle.clampedInt(.nan), 0)
        XCTAssertEqual(RNStyle.clampedInt(.infinity), 0)
    }

    func testFormatValueHugeIntegralDoesNotTrap() {
        // 1e300 is integral, so the old `Int(value)` branch trapped on it.
        XCTAssertFalse(RNStyle.formatValue(1e300).isEmpty)
        XCTAssertFalse(RNStyle.formatValue(-1e300).isEmpty)
        XCTAssertEqual(RNStyle.formatValue(0x1p63), String(format: "%.1f", 0x1p63))
    }

    func testFormatTimerFarFutureDoesNotTrap() {
        // A far-future `until` made every TimelineView tick trap in Int().
        XCTAssertFalse(RNStyle.formatTimer(1e300).isEmpty)
        XCTAssertFalse(RNStyle.formatTimer(-1e300).isEmpty)
    }

    // M4: bounds normalization is shared so the interpreters can't drift —
    // the widget building `min...max` raw trapped on a reversed range the
    // app-side normalization survived.

    func testGaugeBoundsNormalizesReversedRange() {
        let (lo, hi, v) = RNStyle.gaugeBounds(min: 10, max: 0, value: 3)
        XCTAssertEqual(lo, 0)
        XCTAssertEqual(hi, 10)
        XCTAssertEqual(v, 3)
    }

    func testGaugeBoundsClampsValueAndDefaults() {
        let (lo, hi, v) = RNStyle.gaugeBounds(min: nil, max: nil, value: 7)
        XCTAssertEqual(lo, 0)
        XCTAssertEqual(hi, 1)
        XCTAssertEqual(v, 1)  // clamped into 0...1
    }

    func testGaugeBoundsSurvivesNonFinite() {
        let (lo, hi, v) = RNStyle.gaugeBounds(
            min: .nan, max: .infinity, value: .nan)
        XCTAssertEqual(lo, 0)
        XCTAssertEqual(hi, 1)
        XCTAssertEqual(v, 0)
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

    // The staleness gate for in-extension re-renders: a CURRENT stored payload
    // is decoded, not re-rendered (each re-render is a full QuickJS boot).
    func testIsCurrentTrustsAFutureReloadAfter() {
        // Author declared the data good until 1000 — current at 999 even though
        // every entry is in the past, stale at 1000 sharp.
        XCTAssertTrue(
            WidgetSnapshot.isCurrent(
                entryDates: [date(0)], reloadAfter: date(1000),
                publishedAt: date(0), now: date(999)))
        XCTAssertFalse(
            WidgetSnapshot.isCurrent(
                entryDates: [date(0)], reloadAfter: date(1000),
                publishedAt: date(0), now: date(1000)))
    }

    func testIsCurrentWithoutReloadAfterTracksFutureEntries() {
        // Mid-timeline reload (future entries remain) → decode-only; after the
        // last entry passes (.atEnd exhausted) → stale, fresh render.
        let dates = [date(0), date(500)]
        XCTAssertTrue(
            WidgetSnapshot.isCurrent(
                entryDates: dates, reloadAfter: nil,
                publishedAt: date(0), now: date(100)))
        XCTAssertFalse(
            WidgetSnapshot.isCurrent(
                entryDates: dates, reloadAfter: nil,
                publishedAt: date(0), now: date(600)))
    }

    func testIsCurrentHonorsThePublishBurstWindow() {
        // A single "now" entry with no horizon: the reload the publisher pushed
        // right behind its own write decodes the store (within the burst
        // window) — this is what stops an intent tap costing two engine boots —
        // but a later system reload re-renders.
        XCTAssertTrue(
            WidgetSnapshot.isCurrent(
                entryDates: [date(1000)], reloadAfter: nil,
                publishedAt: date(1000), now: date(1030)))
        XCTAssertFalse(
            WidgetSnapshot.isCurrent(
                entryDates: [date(1000)], reloadAfter: nil,
                publishedAt: date(1000), now: date(1100)))
    }

    func testIsCurrentEmptyTimelineIsNeverCurrent() {
        XCTAssertFalse(
            WidgetSnapshot.isCurrent(
                entryDates: [], reloadAfter: date(9000),
                publishedAt: date(0), now: date(0)))
    }

    func testIsCurrentPassedReloadAfterBeatsFutureEntries() {
        // The author asked for a re-render after 100 — stale at 200 even though
        // a future entry exists.
        XCTAssertFalse(
            WidgetSnapshot.isCurrent(
                entryDates: [date(0), date(5000)], reloadAfter: date(100),
                publishedAt: date(0), now: date(200)))
    }
}

// ARCH-06: "is this payload displayable" is no longer a clock question. The
// composite classifier sits ABOVE the (unchanged) time rule; these cases pin
// the precedence, because getting it wrong is silent — a widget that keeps
// showing a number the user already changed looks perfectly healthy.
final class PayloadFreshnessTests: XCTestCase {
    private func date(_ seconds: TimeInterval) -> Date {
        Date(timeIntervalSince1970: seconds)
    }

    /// A payload that the OLD time-only rule calls current: a live horizon, so
    /// every failure below is caused purely by the provenance stamps.
    private func freshness(
        payloadRevision: Int = 5, currentRevision: Int = 5,
        payloadReleaseId: String? = "rel-a", runningReleaseId: String? = "rel-a",
        entryDates: [Date]? = nil, reloadAfter: Date? = nil,
        publishedAt: Date? = nil, now: Date? = nil
    ) -> PayloadFreshness {
        WidgetSnapshot.freshness(
            entryDates: entryDates ?? [date(0)],
            reloadAfter: reloadAfter ?? date(10_000),
            publishedAt: publishedAt ?? date(0), now: now ?? date(100),
            payloadRevision: payloadRevision, currentRevision: currentRevision,
            payloadReleaseId: payloadReleaseId,
            runningReleaseId: runningReleaseId)
    }

    func testMatchingStampsInsideTheHorizonAreCurrent() {
        XCTAssertEqual(freshness(), .current)
    }

    // The acceptance's "test crash between mutation and publication": the write
    // bumped the revision and the publication never reached the store. The
    // payload still sits well inside its author-declared horizon, so the
    // time-only rule would happily display it.
    func testAMutationWithoutAPublicationReadsStale() {
        XCTAssertEqual(
            freshness(payloadRevision: 5, currentRevision: 6), .staleRevision)
    }

    func testStaleRevisionBeatsALiveReloadAfter() {
        // Explicitly: reloadAfter is 100x further out than `now`. Time says
        // current, state says otherwise, state wins.
        XCTAssertEqual(
            freshness(
                payloadRevision: 1, currentRevision: 2,
                reloadAfter: date(1_000_000), now: date(10)),
            .staleRevision)
    }

    func testARevisionFromTheFutureIsAlsoUnprovable() {
        // Can only happen if the counter was lost (container wiped) or the
        // payload came from another App Group — equally unprovable, same
        // remedy. Equality, not `<`, is what the check must be.
        XCTAssertEqual(
            freshness(payloadRevision: 9, currentRevision: 2), .staleRevision)
    }

    func testAForeignProducingReleaseIsRejectedEvenWhenFresh() {
        XCTAssertEqual(
            freshness(payloadReleaseId: "rel-b", runningReleaseId: "rel-a"),
            .foreignRelease)
    }

    func testRevisionOutranksRelease() {
        // Both wrong: report the state problem, which is the one a republish
        // fixes for every reader (a release mismatch only resolves for THIS
        // process's own re-render).
        XCTAssertEqual(
            freshness(
                payloadRevision: 1, currentRevision: 2,
                payloadReleaseId: "rel-b", runningReleaseId: "rel-a"),
            .staleRevision)
    }

    func testAnUnknownReleaseOnEitherSideNeverRejects() {
        // The widget extension can boot precompiled bytecode with no source to
        // hash. If nil meant "mismatch", such a fleet would re-render on every
        // timeline request forever — a full QuickJS boot each time.
        XCTAssertEqual(freshness(payloadReleaseId: nil), .current)
        XCTAssertEqual(freshness(runningReleaseId: nil), .current)
        XCTAssertEqual(
            freshness(payloadReleaseId: nil, runningReleaseId: nil), .current)
    }

    func testMatchingStampsStillExpireOnTheTimeRule() {
        // freshness LAYERS on isCurrent; it doesn't replace it. Horizon passed.
        XCTAssertEqual(
            freshness(reloadAfter: date(50), now: date(100)), .expired)
        // And an empty timeline is never displayable, stamps notwithstanding.
        XCTAssertEqual(
            freshness(entryDates: [], reloadAfter: nil), .expired)
    }
}

// ARCH-06: which of two payloads describes the more recent STATE. Ordering by
// publication time answered a different question and could prefer an older
// state (a re-render that started before a write can land after it).
final class NewestPayloadTests: XCTestCase {
    private func payload(
        revision: Int, publishedAt: Double
    ) -> PublishedWidgets {
        // Decoded from the wire rather than constructed, so these tests also
        // fail if the stamps stop being decodable.
        let json = """
            {"v":1,"publishedAt":\(publishedAt),"stateRevision":\(revision),
             "widgets":{},"controls":{}}
            """
        // swift-format-ignore: NeverForceUnwrap
        return try! JSONDecoder().decode(
            PublishedWidgets.self, from: Data(json.utf8))
    }

    func testNilOperandsFallThrough() {
        let only = payload(revision: 1, publishedAt: 1)
        XCTAssertEqual(WidgetSnapshot.newestPayload(nil, only), only)
        XCTAssertEqual(WidgetSnapshot.newestPayload(only, nil), only)
        XCTAssertNil(WidgetSnapshot.newestPayload(nil, nil))
    }

    func testHigherRevisionWinsRegardlessOfPublicationTime() {
        let older = payload(revision: 9, publishedAt: 100)  // written first
        let newer = payload(revision: 4, publishedAt: 999)  // written later
        // The later WRITE describes older state — an in-extension render that
        // started before an intent's write and finished after it.
        XCTAssertEqual(WidgetSnapshot.newestPayload(older, newer), older)
        XCTAssertEqual(WidgetSnapshot.newestPayload(newer, older), older)
    }

    func testPublicationTimeBreaksTiesWithinOneRevision() {
        let first = payload(revision: 3, publishedAt: 100)
        let second = payload(revision: 3, publishedAt: 200)
        XCTAssertEqual(WidgetSnapshot.newestPayload(first, second), second)
        XCTAssertEqual(WidgetSnapshot.newestPayload(second, first), second)
    }
}

// ARCH-06: the batching rule that keeps "every mutation moves the revision"
// from costing one cross-process file claim per Storage.set.
final class StateRevisionTrackerTests: XCTestCase {
    func testOnlyTheFirstWriteOfABatchBumps() {
        var tracker = StateRevisionTracker()
        XCTAssertTrue(tracker.needsBump(), "first write opens the batch")
        XCTAssertFalse(tracker.needsBump())
        XCTAssertFalse(tracker.needsBump())
    }

    func testClosingTheBatchRearmsTheNextOne() {
        var tracker = StateRevisionTracker()
        XCTAssertTrue(tracker.needsBump())
        tracker.closeBatch()
        // A write AFTER a publication must move the revision past the one that
        // publication stamped — otherwise the stored payload would still claim
        // to describe the mutated state.
        XCTAssertTrue(tracker.needsBump())
        XCTAssertFalse(tracker.needsBump())
    }

    func testClosingWithoutWritesLeavesTheBatchArmed() {
        var tracker = StateRevisionTracker()
        tracker.closeBatch()
        tracker.closeBatch()
        XCTAssertTrue(tracker.needsBump())
    }

    /// A foreign publication has to close this process's batch too (ARCH-06).
    ///
    /// The app's tracker only ever sees the app's own writes, but the payload a
    /// consumer compares against is whatever landed in the SHARED store — which
    /// the widget extension also writes. Without the reconcile-time close, the
    /// app's next write skips its bump and the extension's payload keeps reading
    /// `.current` while state has moved, with no check able to notice.
    ///
    /// Two trackers over ONE counter directory, wired exactly like the two
    /// committed sites.
    func testAForeignPublicationClosesThisProcessesBatch() {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("revision-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let revision = CoordinatedCounterStore(directory: dir)
        var app = StateRevisionTracker()
        var extensionTracker = StateRevisionTracker()
        func write(_ tracker: inout StateRevisionTracker) {
            guard tracker.needsBump() else { return }
            revision.add(1, toKey: StateRevisionTracker.key, min: 0, max: .max)
        }
        let live = { revision.value(forKey: StateRevisionTracker.key) }

        // 1. App writes, publishes: the store is at the live revision.
        write(&app)
        app.closeBatch()
        var storedPayloadRevision = live()

        // 2. App writes again and is suspended before it can publish. The store
        //    is stale but DETECTABLE — that is what step 3 acts on.
        write(&app)
        XCTAssertNotEqual(storedPayloadRevision, live())

        // 3. WidgetKit asks for a timeline in the EXTENSION process; it renders
        //    fresh and saves a payload stamped at the live revision.
        _ = extensionTracker.needsBump()
        storedPayloadRevision = live()

        // 4. App foregrounds and reconciles. Revisions match, so the republish
        //    is correctly skipped — but the batch must still close, because the
        //    payload now in the store is not one this process published.
        app.closeBatch()

        // 5. The user changes state in the app.
        write(&app)

        // 6. The next timeline request must see the store as stale.
        XCTAssertNotEqual(
            storedPayloadRevision, live(),
            "a write after a foreign publication must move the revision past it")
        XCTAssertEqual(
            WidgetSnapshot.freshness(
                entryDates: [Date()], reloadAfter: nil, publishedAt: Date(),
                now: Date(), payloadRevision: storedPayloadRevision,
                currentRevision: live(), payloadReleaseId: nil,
                runningReleaseId: nil),
            .staleRevision)
    }

    // The counter this gates must not be reachable from JS: keys become file
    // names, so a bundle calling Storage.counterAdd("state", …) would write the
    // revision itself if both lived in `counters/`.
    func testTheRevisionCounterHasItsOwnNamespace() {
        XCTAssertNotEqual(StateRevisionTracker.subdirectory, "counters")
    }
}

// ARCH-06: the revision counter is a CoordinatedCounterStore pointed at its own
// subdirectory. Same monotonic/atomic guarantees as the ARCH-05 counters, and —
// the point of the separate directory — the same key in the two namespaces is
// two independent counters.
final class StateRevisionCounterTests: XCTestCase {
    func testSameKeyInSeparateSubdirectoriesIsIsolated() {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("revision-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let counters = CoordinatedCounterStore(
            directory: root.appendingPathComponent("counters"))
        let revision = CoordinatedCounterStore(
            directory: root.appendingPathComponent(
                StateRevisionTracker.subdirectory))

        // A bundle doing Storage.counterAdd("state", …) — the exact collision.
        counters.add(41, toKey: StateRevisionTracker.key, min: 0, max: .max)
        revision.add(1, toKey: StateRevisionTracker.key, min: 0, max: .max)

        XCTAssertEqual(revision.value(forKey: StateRevisionTracker.key), 1)
        XCTAssertEqual(counters.value(forKey: StateRevisionTracker.key), 41)
    }

    func testRevisionOnlyEverMovesForward() {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("revision-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CoordinatedCounterStore(directory: dir)
        var last = 0
        for _ in 0..<5 {
            let next = store.add(
                1, toKey: StateRevisionTracker.key, min: 0, max: .max)
            XCTAssertGreaterThan(next, last)
            last = next
        }
        // Survives the process boundary the app and the extension sit across.
        XCTAssertEqual(
            CoordinatedCounterStore(directory: dir)
                .value(forKey: StateRevisionTracker.key), 5)
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
            {"v":1,"publishedAt":1000,"stateRevision":7,"releaseId":"abc123",
             "widgets":{"hydration":{"accessoryCircular":{
               "entries":[{"date":2000,"tree":null,"url":null,"relevance":null}],
               "reloadAfter":null,"relevantContexts":null}}},
             "controls":{"hydration.addGlass":
               {"intent":"addGlass","label":"Add Glass","systemName":"drop.fill"}}}
            """
        store.save(json)

        let loaded = store.loadPublishedWidgets()
        XCTAssertEqual(loaded?.v, 1)
        // ARCH-06: the revision + producing release ride INSIDE the one JSON
        // string under the one UserDefaults key, so a payload and its stamps
        // can never be torn apart by a crash — that half of "persist state
        // revision and payload atomically" is free.
        XCTAssertEqual(loaded?.stateRevision, 7)
        XCTAssertEqual(loaded?.releaseId, "abc123")
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

    // ARCH-06: a TimelineProvider must be able to name its OWN release without
    // booting an engine — the boot is exactly what the freshness check exists
    // to avoid — so the widget runtime records it here on each boot.
    func testWidgetReleaseIdRoundTripsAndIgnoresEmpty() {
        XCTAssertNil(
            store.widgetReleaseId(),
            "before the extension has booted, the reader's release is unknown")
        store.saveWidgetReleaseId("rel-a")
        XCTAssertEqual(store.widgetReleaseId(), "rel-a")
        // A nil/empty id means "unknown" — it must not overwrite a known one
        // with a value that would read as a mismatch-free blank.
        store.saveWidgetReleaseId(nil)
        store.saveWidgetReleaseId("")
        XCTAssertEqual(store.widgetReleaseId(), "rel-a")
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

    func testAddSaturatesInsteadOfTrappingOnOverflow() {
        // A huge delta or a corrupt/oversized stored value must clamp to the
        // range, never trap the process on Int overflow (both app + widget
        // extension run this — ARCH-05). The old `(current) + delta` before the
        // clamp would crash here.
        let (store, dir) = tempStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        // Seed at Int.max, then a positive add overflows Int -> clamps to max.
        XCTAssertEqual(
            store.add(Int.max, toKey: "g", min: 0, max: Int.max), Int.max)
        XCTAssertEqual(store.add(1, toKey: "g", min: 0, max: 8), 8)
        // Symmetric underflow: seed Int.min, a negative add underflows -> min.
        XCTAssertEqual(
            store.add(Int.min, toKey: "h", min: Int.min, max: 0), Int.min)
        XCTAssertEqual(store.add(-1, toKey: "h", min: 0, max: 8), 0)
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
            WidgetBundleChoice.decide(
                knownGood: nil, bytecodeHashMatches: true,
                keyState: .disabled, recordVerified: false),
            .shipped)
    }

    func testEmptyKnownGoodRecordFallsBackToShipped() {
        // A record with no source is unusable — don't run an empty bundle.
        XCTAssertEqual(
            WidgetBundleChoice.decide(
                knownGood: record(""), bytecodeHashMatches: true,
                keyState: .disabled, recordVerified: false),
            .shipped)
    }

    func testRunsPinnedBytecodeOnlyWhenHashMatches() {
        // .disabled = the unsigned dev opt-in, so the app-promoted record runs.
        XCTAssertEqual(
            WidgetBundleChoice.decide(
                knownGood: record("globalThis.x=1;"), bytecodeHashMatches: true,
                keyState: .disabled, recordVerified: false),
            .knownGoodBytecode)
        // Stale/absent bytecode → parse the source, never run unpinned bytecode.
        XCTAssertEqual(
            WidgetBundleChoice.decide(
                knownGood: record("globalThis.x=1;"), bytecodeHashMatches: false,
                keyState: .disabled, recordVerified: false),
            .knownGoodSource)
    }

    func testEnforcedRunsKnownGoodOnlyWhenSignatureVerifies() {
        // NF-35: with keys enforced, the App-Group known-good record must
        // re-verify in the extension. Verified → run its SOURCE — never the
        // bytecode, even on a hash match: the signature covers the source
        // only, and `bytecodeHash` is an unsigned field an App-Group writer
        // also controls (the same attack the app's evalOTA refuses).
        XCTAssertEqual(
            WidgetBundleChoice.decide(
                knownGood: record("globalThis.x=1;"), bytecodeHashMatches: true,
                keyState: .enforced, recordVerified: true),
            .knownGoodSource)
        // ...unverified (attacker-overwritten record) → shipped, NOT the record.
        XCTAssertEqual(
            WidgetBundleChoice.decide(
                knownGood: record("globalThis.x=1;"), bytecodeHashMatches: true,
                keyState: .enforced, recordVerified: false),
            .shipped)
    }

    func testMisconfiguredOrUnconfiguredKeysFailClosedToShipped() {
        // No usable key to authenticate the record → never run it.
        for state in [OTAKeyState.misconfigured, .unconfigured] {
            XCTAssertEqual(
                WidgetBundleChoice.decide(
                    knownGood: record("globalThis.x=1;"), bytecodeHashMatches: true,
                    keyState: state, recordVerified: false),
                .shipped)
        }
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

final class RNStyleAnimationTests: XCTestCase {
    func testParsesKindAndDuration() {
        XCTAssertEqual(
            RNStyle.animation(
                from: .object(["kind": .string("spring"), "duration": .number(0.3)])),
            RNStyle.AnimationSpec(kind: .spring, duration: 0.3))
        XCTAssertEqual(
            RNStyle.animation(from: .object(["kind": .string("linear")])),
            RNStyle.AnimationSpec(kind: .linear))
    }

    func testMalformedAnimationIsNil() {
        XCTAssertNil(RNStyle.animation(from: nil))
        XCTAssertNil(RNStyle.animation(from: .string("spring")))
        XCTAssertNil(RNStyle.animation(from: .object(["kind": .string("bounce")])))
        XCTAssertNil(RNStyle.animation(from: .object(["duration": .number(1)])))
    }
}

// NF-35: the stored record's signedMessage must be byte-identical to
// UpdatePlan's, or save-time verification and boot-time re-verification
// could accept different bytes.
final class OTARecordSignedMessageTests: XCTestCase {
    func testMatchesUpdatePlanFormat() {
        let record = OTARecord(
            js: "globalThis.x=1", keyId: "abc123", version: 4, signature: "s")
        let plan = UpdatePlan(
            payload: #"{"js":"globalThis.x=1","keyId":"abc123","version":4}"#)
        XCTAssertEqual(record.signedMessage(), plan.signedMessage())
        XCTAssertEqual(
            record.signedMessage(),
            Data("v2:abc123:4:0:globalThis.x=1".utf8))
    }

    func testUnsignedOrInvalidRecordsHaveNoMessage() {
        XCTAssertNil(
            OTARecord(js: "x", keyId: nil, version: 1, signature: nil)
                .signedMessage())
        XCTAssertNil(
            OTARecord(js: "x", keyId: "abc123", version: nil, signature: nil)
                .signedMessage())
        XCTAssertNil(
            OTARecord(js: "x", keyId: "bad:colon", version: 1, signature: nil)
                .signedMessage())
    }
}

final class RNStyleChartTests: XCTestCase {
    func testParsesNumericAndCategoricalPoints() {
        let points = RNStyle.chartPoints(
            from: .array([
                .object(["x": .number(1), "y": .number(10)]),
                .object(["x": .string("Mon"), "y": .number(3)]),
            ]))
        XCTAssertEqual(
            points,
            [
                RNStyle.ChartPoint(x: 1, y: 10),
                RNStyle.ChartPoint(label: "Mon", y: 3),
            ])
    }

    func testDropsMalformedPointsKeepsRest() {
        let points = RNStyle.chartPoints(
            from: .array([
                .object(["x": .number(1)]),  // no y -> dropped
                .string("junk"),
                .object(["y": .number(5)]),  // x optional (index-less)
            ]))
        XCTAssertEqual(points, [RNStyle.ChartPoint(y: 5)])
        XCTAssertEqual(RNStyle.chartPoints(from: nil), [])
    }
}

// RNFormat (i18n step 2): the FormattedText kernel. Locale + timezone are
// pinned so the assertions hold on Linux and macOS ICU alike; time strings
// avoid exact spaces (newer ICU inserts a narrow NBSP before AM/PM).
final class RNFormatTests: XCTestCase {
    private let en = Locale(identifier: "en_US")
    private let de = Locale(identifier: "de_DE")
    private let utc = TimeZone(identifier: "UTC")!

    /// Epoch ms for a UTC calendar date, built via Calendar so the tests
    /// don't hand-roll epoch arithmetic.
    private func ms(
        _ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0
    ) -> Double {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        let components = DateComponents(
            year: year, month: month, day: day, hour: hour, minute: minute)
        return calendar.date(from: components)!.timeIntervalSince1970 * 1000
    }

    func testBareDateDefaultsToMediumDateWithNoTime() {
        let out = RNFormat.date(
            ms: ms(2026, 1, 15, 13, 20), dateStyle: nil, timeStyle: nil,
            locale: en, timeZone: utc)
        XCTAssertEqual(out, "Jan 15, 2026")
    }

    func testTimeOnlyHasNoSurpriseDatePrefix() {
        let out = RNFormat.date(
            ms: ms(2026, 1, 15, 13, 20), dateStyle: nil, timeStyle: "short",
            locale: en, timeZone: utc)
        XCTAssertTrue(out.contains("1:20"), "got: \(out)")
        XCTAssertFalse(out.contains("2026"), "time-only must not render the date: \(out)")
    }

    func testLocaleDrivesTheDateShape() {
        let out = RNFormat.date(
            ms: ms(2026, 1, 15), dateStyle: "short", timeStyle: nil,
            locale: de, timeZone: utc)
        XCTAssertEqual(out, "15.01.26")
    }

    func testDecimalUsesLocaleSeparators() {
        XCTAssertEqual(
            RNFormat.number(
                1234.5, format: nil, currency: nil,
                minFractionDigits: nil, maxFractionDigits: nil, locale: en),
            "1,234.5")
        XCTAssertEqual(
            RNFormat.number(
                1234.5, format: "decimal", currency: nil,
                minFractionDigits: nil, maxFractionDigits: nil, locale: de),
            "1.234,5")
    }

    func testPercentFollowsTheIntlConvention() {
        XCTAssertEqual(
            RNFormat.number(
                0.5, format: "percent", currency: nil,
                minFractionDigits: nil, maxFractionDigits: nil, locale: en),
            "50%")
    }

    func testCurrencyUsesTheGivenCode() {
        let out = RNFormat.number(
            1234.5, format: "currency", currency: "USD",
            minFractionDigits: nil, maxFractionDigits: nil, locale: en)
        XCTAssertEqual(out, "$1,234.50")
    }

    func testFractionDigitsApplyAndAHostileValueCannotTrap() {
        XCTAssertEqual(
            RNFormat.number(
                1.5, format: nil, currency: nil,
                minFractionDigits: 3, maxFractionDigits: nil, locale: en),
            "1.500")
        // M3 family: a huge JS double must clamp, not trap Int().
        XCTAssertEqual(
            RNFormat.number(
                1.25, format: nil, currency: nil,
                minFractionDigits: nil, maxFractionDigits: 1e300, locale: en),
            "1.25")
    }

    func testUnknownNumberFormatFallsBackToDecimal() {
        XCTAssertEqual(
            RNFormat.number(
                7, format: "bogus", currency: nil,
                minFractionDigits: nil, maxFractionDigits: nil, locale: en),
            "7")
    }

    func testNodeUnpackingDateWinsOverValue() {
        let out = RNFormat.text(
            dateMs: ms(2026, 1, 15), dateStyle: nil, timeStyle: nil,
            value: 42, format: nil, currency: nil,
            minFractionDigits: nil, maxFractionDigits: nil,
            locale: en, timeZone: utc)
        XCTAssertEqual(out, "Jan 15, 2026")
    }

    func testNeitherDateNorValueRendersEmpty() {
        let out = RNFormat.text(
            dateMs: nil, dateStyle: nil, timeStyle: nil,
            value: nil, format: nil, currency: nil,
            minFractionDigits: nil, maxFractionDigits: nil,
            locale: en, timeZone: utc)
        XCTAssertEqual(out, "")
    }
}

// OTA transport policy (review §6.11c) — mirrored by js update.ts
// `updateURLViolation`; the two matrices must stay identical.
final class UpdateURLPolicyTests: XCTestCase {
    func testHttpsIsAlwaysAllowed() {
        XCTAssertNil(UpdateURLPolicy.violation(of: "https://updates.example.com/m.json"))
    }

    func testPublicHttpIsRefused() {
        XCTAssertNotNil(UpdateURLPolicy.violation(of: "http://updates.example.com/m.json"))
    }

    func testDevHostsMayUsePlainHttp() {
        for url in [
            "http://localhost:8788/manifest.json",
            "http://127.0.0.1:8788/manifest.json",
            "http://10.0.1.5/m.json",
            "http://192.168.1.20/m.json",
            "http://172.16.0.2/m.json",
            "http://172.31.255.1/m.json",
            "http://emins-mac.local:8788/m.json",
        ] {
            XCTAssertNil(UpdateURLPolicy.violation(of: url), url)
        }
    }

    func testNearMissPrivateRangesAreRefused() {
        for url in [
            "http://172.15.0.2/m.json",  // below the /12
            "http://172.32.0.2/m.json",  // above the /12
            "http://1270.0.0.1/m.json",  // not loopback
            "http://mylocal.example.com/m.json",  // ".local" only as a suffix label
        ] {
            XCTAssertNotNil(UpdateURLPolicy.violation(of: url), url)
        }
    }

    func testNonHTTPSchemesAndRelativeURLsAreRefused() {
        XCTAssertNotNil(UpdateURLPolicy.violation(of: "ftp://x.example/m.json"))
        XCTAssertNotNil(UpdateURLPolicy.violation(of: "/relative/manifest.json"))
    }
}

/// The deep-link scheme bridge: parsing CFBundleURLTypes, the JS injection
/// string, and the App-Group publish/read the widget process relies on.
final class HostURLSchemeTests: XCTestCase {
    func testFirstSchemeReadsFirstNonEmptyEntry() {
        let types: [[String: Any]] = [
            ["CFBundleURLName": "x", "CFBundleURLSchemes": [String]()],
            ["CFBundleURLName": "y", "CFBundleURLSchemes": ["com.acme.myapp", "alt"]],
        ]
        XCTAssertEqual(HostURLScheme.firstScheme(in: types), "com.acme.myapp")
        XCTAssertNil(HostURLScheme.firstScheme(in: nil))
        XCTAssertNil(HostURLScheme.firstScheme(in: []))
    }

    func testInjectEmitsGlobalOrEmpty() {
        XCTAssertEqual(
            HostURLScheme.inject("com.acme.myapp"),
            "globalThis.__urlScheme='com.acme.myapp';")
        XCTAssertEqual(HostURLScheme.inject(nil), "")
        XCTAssertEqual(HostURLScheme.inject(""), "")
        // Defensive escaping so a crafted scheme can't break out of the literal.
        XCTAssertEqual(
            HostURLScheme.inject("a'b\\c"),
            "globalThis.__urlScheme='a\\'b\\\\c';")
    }

    func testAppGroupSchemePublishRoundTrips() {
        let suite = "group.test.\(UUID().uuidString)"
        let store = SharedWidgetStore(appGroupId: suite)
        XCTAssertNil(store.urlScheme())
        store.saveURLScheme("com.acme.myapp")
        XCTAssertEqual(store.urlScheme(), "com.acme.myapp")
        // Empty/nil is a no-op (never clobbers a published value with "").
        store.saveURLScheme("")
        XCTAssertEqual(store.urlScheme(), "com.acme.myapp")
        UserDefaults().removePersistentDomain(forName: suite)
    }
}

/// ARCH-13: the structured Diagnostic record and the bounded ring that
/// replaces the host's last-write-wins error strings.
final class DiagnosticsTests: XCTestCase {
    private func make(
        _ code: String, severity: Diagnostic.Severity = .recoverable
    ) -> Diagnostic {
        Diagnostic(
            code: code, severity: severity, subsystem: .ota,
            sessionId: "s-1", target: .watch)
    }

    func testDiagnosticRoundTripsThroughJSON() throws {
        let diagnostic = Diagnostic(
            code: "ota.saveRejected", severity: .recoverable, subsystem: .ota,
            sessionId: "s-1", releaseId: "abc123", target: .watch,
            timestamp: 1_700_000_000_000, details: "signature invalid")
        let data = try JSONEncoder().encode(diagnostic)
        let decoded = try JSONDecoder().decode(Diagnostic.self, from: data)
        XCTAssertEqual(decoded, diagnostic)
        // The enums serialize as their raw strings — the shape JS receives on
        // the `diagnostic` native event.
        let obj = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(obj["severity"] as? String, "recoverable")
        XCTAssertEqual(obj["subsystem"] as? String, "ota")
        XCTAssertEqual(obj["target"] as? String, "watch")
    }

    func testMessagePrefersDetailsOverCode() {
        XCTAssertEqual(
            Diagnostic(
                code: "boot.startupFailed", severity: .fatal, subsystem: .boot,
                sessionId: "s", target: .watch, details: "JS startup failed"
            ).message,
            "JS startup failed")
        XCTAssertEqual(make("commit.decodeFailed").message, "commit.decodeFailed")
    }

    func testRingKeepsOnlyTheMostRecentEntries() {
        let ring = DiagnosticsBuffer(capacity: 3)
        for n in 1...5 { ring.append(make("code.\(n)")) }
        XCTAssertEqual(ring.all.map(\.code), ["code.3", "code.4", "code.5"])
    }

    func testLatestFindsNewestOfEachSeverity() {
        let ring = DiagnosticsBuffer()
        XCTAssertNil(ring.latest(severity: .fatal))
        ring.append(make("a", severity: .fatal))
        ring.append(make("b", severity: .recoverable))
        ring.append(make("c", severity: .fatal))
        ring.append(make("d", severity: .info))
        XCTAssertEqual(ring.latest(severity: .fatal)?.code, "c")
        XCTAssertEqual(ring.latest(severity: .recoverable)?.code, "b")
        XCTAssertEqual(ring.latest(severity: .info)?.code, "d")
    }

    func testSinkEmitDoesNotCrashOnAnyShape() {
        // The default sink is fire-and-forget logging; just prove it accepts
        // both a bare and a fully-populated record.
        let sink = LogDiagnosticsSink()
        sink.emit(make("bare.code"))
        sink.emit(
            Diagnostic(
                code: "budget.maxNodes", severity: .info, subsystem: .budget,
                sessionId: "s", releaseId: "r", target: .widget,
                userAction: "none", details: "over budget"))
    }
}

/// ARCH-13 operating budgets: breaches WARN (recoverable `budget`
/// diagnostics), never reject a commit, and hysteresis makes each crossing
/// warn exactly once — a tree that STAYS big must not spam a diagnostic per
/// commit at sensor-driven commit rates.
final class BudgetPolicyTests: XCTestCase {
    func testCrossingEmitsOnceUntilItReArms() {
        var policy = BudgetPolicy(maxCommitJSONBytes: 100)
        let first = policy.check(
            commitJSONBytes: 150, sessionId: "s", target: .watch)
        XCTAssertEqual(first.map(\.code), ["budget.maxCommitJSONBytes"])
        XCTAssertEqual(first.first?.severity, .recoverable)
        XCTAssertEqual(first.first?.subsystem, .budget)
        // Still over: no new diagnostic (once per crossing).
        XCTAssertTrue(
            policy.check(commitJSONBytes: 200, sessionId: "s", target: .watch)
                .isEmpty)
        // Back under: re-arms silently.
        XCTAssertTrue(
            policy.check(commitJSONBytes: 50, sessionId: "s", target: .watch)
                .isEmpty)
        // Re-crossing warns again.
        XCTAssertEqual(
            policy.check(commitJSONBytes: 150, sessionId: "s", target: .watch)
                .map(\.code),
            ["budget.maxCommitJSONBytes"])
    }

    func testEachBudgetTracksItsOwnHysteresis() {
        var policy = BudgetPolicy(maxNodes: 10, maxCommitJSONBytes: 100)
        // Both cross in one check → two diagnostics.
        XCTAssertEqual(
            policy.check(
                nodeCount: 20, commitJSONBytes: 150, sessionId: "s",
                target: .watch
            ).map(\.code),
            ["budget.maxNodes", "budget.maxCommitJSONBytes"])
        // Nodes recover, bytes stay over → nothing new; then only nodes
        // re-cross.
        XCTAssertTrue(
            policy.check(
                nodeCount: 5, commitJSONBytes: 150, sessionId: "s",
                target: .watch
            ).isEmpty)
        XCTAssertEqual(
            policy.check(
                nodeCount: 20, commitJSONBytes: 150, sessionId: "s",
                target: .watch
            ).map(\.code),
            ["budget.maxNodes"])
    }

    func testNilMeasurementLeavesHysteresisUntouched() {
        var policy = BudgetPolicy(maxCommitJSONBytes: 100)
        XCTAssertEqual(
            policy.check(commitJSONBytes: 150, sessionId: "s", target: .watch)
                .count,
            1)
        // A check that doesn't measure bytes (e.g. a widget render check)
        // must not re-arm the bytes breach.
        XCTAssertTrue(
            policy.check(widgetRenderMs: 1, sessionId: "s", target: .watch)
                .isEmpty)
        XCTAssertTrue(
            policy.check(commitJSONBytes: 150, sessionId: "s", target: .watch)
                .isEmpty)
    }

    func testWidgetRenderBudgetStampsContext() throws {
        var policy = BudgetPolicy(maxWidgetRenderMs: 500)
        let crossed = policy.check(
            widgetRenderMs: 750.5, sessionId: "widget-session",
            releaseId: "abc", target: .widget)
        let diagnostic = try XCTUnwrap(crossed.first)
        XCTAssertEqual(diagnostic.code, "budget.maxWidgetRenderMs")
        XCTAssertEqual(diagnostic.sessionId, "widget-session")
        XCTAssertEqual(diagnostic.releaseId, "abc")
        XCTAssertEqual(diagnostic.target, .widget)
        XCTAssertTrue(
            diagnostic.details?.contains("750.5 ms") == true,
            diagnostic.details ?? "nil")
    }

    func testDefaultsMatchTheDocumentedNumbers() {
        // docs/budgets-and-limits.md + js/src/budgets.ts mirror these.
        let policy = BudgetPolicy()
        XCTAssertEqual(policy.maxNodes, 1000)
        XCTAssertEqual(policy.maxCommitJSONBytes, 262_144)
        XCTAssertEqual(policy.maxWidgetRenderMs, 500)
    }

    func testExactLimitIsNotABreach() {
        var policy = BudgetPolicy(maxNodes: 10, maxCommitJSONBytes: 100)
        XCTAssertTrue(
            policy.check(
                nodeCount: 10, commitJSONBytes: 100, sessionId: "s",
                target: .watch
            ).isEmpty)
    }
}
