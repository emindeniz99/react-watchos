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

    // An UNNAMED bracket segment is not a wildcard (aligned with js
    // matchRoute, 2026-07-28). `RouteMatcher` used to accept an empty name and
    // make `[]`/`[...]`/`[[...]]` a param/catch-all called "" — so `/[]`
    // swallowed any one segment and `/[[...]]` matched literally anything,
    // while js (three regexes anchored on `(.+)`) matched none of them and
    // Next.js rejects unnamed segments at build time. A capture nothing can
    // read back is not a route: the destination would render with an empty
    // `useParams()`.
    func testUnnamedBracketSegmentsAreNotWildcards() {
        XCTAssertNil(RouteMatcher.match(pattern: "/[]", route: "/x"))
        XCTAssertNil(RouteMatcher.match(pattern: "/[...]", route: "/a/b"))
        XCTAssertNil(RouteMatcher.match(pattern: "/[[...]]", route: "/"))
        XCTAssertNil(RouteMatcher.match(pattern: "/[[...]]", route: "/a/b"))
        // It doesn't become "never matches" either: each form falls through to
        // the next one exactly as js does, so `[]` is a LITERAL and `[...]` a
        // param whose name really is "...". Pinned here because the fixture
        // table only carries the four rejections.
        XCTAssertEqual(RouteMatcher.match(pattern: "/[]", route: "/[]")?.params, [:])
        XCTAssertEqual(RouteMatcher.match(pattern: "/[]", route: "/[]")?.score, 2)
        XCTAssertEqual(
            RouteMatcher.match(pattern: "/[...]", route: "/a")?.params, ["...": ["a"]])
        XCTAssertEqual(
            RouteMatcher.match(pattern: "/[[...]]", route: "/a")?.params,
            ["[...]": ["a"]])
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

/// The cross-language half of the route contract. `RouteMatcher` and js
/// `matchRoute` are two hand-kept implementations of one syntax: a deep link
/// they disagree about renders one screen with another's params, and until this
/// fixture existed each side was only ever checked against its OWN hand-written
/// expectations — the arrangement that lets two implementations drift while
/// both stay green.
///
/// `js/test/route-contract.test.ts` runs the REAL `matchRoute` over a case table
/// spanning literals, `[param]`, `[...catchAll]`, `[[...optional]]`, segment
/// splitting and percent-decoding, and writes its ACTUAL output here. This
/// decodes that output and requires `RouteMatcher` to reproduce it exactly —
/// params and specificity score, matches and non-matches alike.
final class RouteMatcherConformanceTests: XCTestCase {
    private struct Expected: Decodable {
        /// JS captures a `[id]` param as a bare string and a catch-all as an
        /// array; the fixture normalizes both to arrays, which is Swift's own
        /// representation.
        let params: [String: [String]]
        let score: Int
    }

    private struct Case: Decodable {
        let pattern: String
        let route: String
        /// nil = `matchRoute` rejected this route for this pattern.
        let match: Expected?
    }

    private struct Fixture: Decodable {
        let cases: [Case]
    }

    func testMatchesTheJSMatcherOnEveryCase() throws {
        let url = try XCTUnwrap(
            Bundle.module.url(
                forResource: "route-cases", withExtension: "json",
                subdirectory: "Fixtures"
            ),
            "missing fixture route-cases.json — run the JS suite to regenerate"
        )
        let fixture = try JSONDecoder().decode(
            Fixture.self, from: try Data(contentsOf: url))

        // A truncated fixture must not read as a pass: the JS side asserts the
        // same floors before writing, so a table that lost its matching or its
        // rejecting half fails on both sides.
        XCTAssertGreaterThan(fixture.cases.count, 30)
        XCTAssertGreaterThan(fixture.cases.filter { $0.match != nil }.count, 20)
        XCTAssertGreaterThan(fixture.cases.filter { $0.match == nil }.count, 8)

        for testCase in fixture.cases {
            let label = "pattern \(testCase.pattern) route \(testCase.route)"
            let actual = RouteMatcher.match(
                pattern: testCase.pattern, route: testCase.route)
            guard let expected = testCase.match else {
                XCTAssertNil(actual, "\(label): js rejects it, Swift matched")
                continue
            }
            let match = try XCTUnwrap(actual, "\(label): js matches it, Swift did not")
            XCTAssertEqual(match.params, expected.params, "\(label): params differ")
            XCTAssertEqual(match.score, expected.score, "\(label): score differs")
        }
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

    /// The asymmetry the poisoned-OTA fallback boot turns on. `takeAllPending()`
    /// is ALL the session work `BluetoothBridge.resetPendingForReload()` does,
    /// and it deliberately keeps the subscription INTENT and the auto-reconnect
    /// latch, because on a dev hot-reload the same app's next bundle wants its
    /// link back. That carve-out must not be the whole story after a poisoned
    /// OTA eval, where the bundle that asked for those subscriptions is dead and
    /// rejected: left alone, `finishDiscovery` re-applies them on any
    /// rediscovery and the RECOVERY bundle starts receiving ble.notify for
    /// characteristics it never subscribed to, over a link it never opened.
    /// `endByUser()` — what `disconnect()` calls — is the only thing here that
    /// ends both, which is why that path cannot reuse the reload teardown alone.
    func testDrainingPendingForAReloadKeepsSubscriptionIntentThatOnlyEndByUserDrops() {
        var s = BleSession()
        s.beginConnect()
        s.wantSubscription("HR")
        _ = s.awaitSubscribe(characteristic: "HR", id: 9)

        XCTAssertEqual(s.takeAllPending(), [9], "only the id correlation is dropped")
        XCTAssertEqual(
            s.desiredSubscriptions, ["HR"],
            "the hot-reload carve-out: the NEXT bundle inherits these")
        XCTAssertTrue(s.shouldAutoReconnect, "and the link is still expected back")

        s.endByUser()
        XCTAssertTrue(s.desiredSubscriptions.isEmpty)
        XCTAssertFalse(s.shouldAutoReconnect)
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

    func testHealthAndWorkoutsAreSeparatelyDeniable() {
        // The whole reason they are two features and not one: reads disclose
        // the user's stored health HISTORY, while workouts WRITE a permanent
        // HKWorkout, occupy the single system workout slot and grant background
        // execution. An app must be able to say yes to one and no to the other,
        // which is only true if a policy can deny them independently.
        XCTAssertEqual(
            HostPolicy.allow(["health"]).authorize(
                bundleFeatures: ["health", "workouts"],
                native: HostFeatures.watch),
            .denied(byPolicy: ["workouts"])
        )
        XCTAssertEqual(
            HostPolicy.allow(["workouts"]).authorize(
                bundleFeatures: ["health", "workouts"],
                native: HostFeatures.watch),
            .denied(byPolicy: ["health"])
        )
        // ...and that neither leaks through `sensors`, which grants the live
        // heart-rate stream and the pedometer and must not imply either.
        XCTAssertEqual(
            HostPolicy.allow(["sensors"]).authorize(
                bundleFeatures: ["health", "sensors", "workouts"],
                native: HostFeatures.watch),
            .denied(byPolicy: ["health", "workouts"])
        )
    }

    func testWorkoutPlansIsDeniableSeparatelyFromWorkouts() {
        // The ARCH-07 authorization-unit test, and here BOTH halves pass
        // decisively. A WorkoutKit plan writes no health data and occupies no
        // system resource — it is a scheduled document plus a branded
        // placement in Apple's Workout app — and, the clinching point, it has
        // its OWN independently-grantable consent
        // (WorkoutScheduler.requestAuthorization returns a real verdict). A
        // training-plan app needs zero live-session capability; a meditation
        // timer that records a workout needs zero scheduling.
        XCTAssertEqual(
            HostPolicy.allow(["workouts"]).authorize(
                bundleFeatures: ["workouts", "workoutPlans"],
                native: HostFeatures.watch),
            .denied(byPolicy: ["workoutPlans"])
        )
        XCTAssertEqual(
            HostPolicy.allow(["workoutPlans"]).authorize(
                bundleFeatures: ["workouts", "workoutPlans"],
                native: HostFeatures.watch),
            .denied(byPolicy: ["workouts"])
        )
        // ...and it does not ride in on `health` either: reading the user's
        // health history and scheduling a document in another app's UI are
        // different disclosures with different OS consents.
        XCTAssertEqual(
            HostPolicy.allow(["health"]).authorize(
                bundleFeatures: ["health", "workoutPlans"],
                native: HostFeatures.watch),
            .denied(byPolicy: ["workoutPlans"])
        )
    }

    func testTheWatchProvidesHealthAndWorkoutsAndTheWidgetDoesNot() {
        // Widget exposure is handled for free rather than special-cased: the
        // methods are watch-only, so they never enter HostFeatures.widget and
        // WidgetIntentRuntime's typed rejecter answers UNAVAILABLE. An
        // HKWorkoutSession in an extension is a non-starter anyway (it needs
        // the APP's workout-processing mode and the single system slot), and
        // async HealthKit I/O inside getTimeline is metered against both the
        // battery and the WidgetKit refresh budget.
        XCTAssertTrue(HostFeatures.watch.contains("health"))
        XCTAssertTrue(HostFeatures.watch.contains("workouts"))
        XCTAssertTrue(HostFeatures.watch.contains("workoutPlans"))
        XCTAssertFalse(HostFeatures.widget.contains("health"))
        XCTAssertFalse(HostFeatures.widget.contains("workouts"))
        // Free, not special-cased: the methods are watch-only, so the feature
        // never enters HostFeatures.widget and WidgetIntentRuntime's typed
        // rejecter answers UNAVAILABLE. A widget presenting a permission sheet
        // inside getTimeline is a non-starter anyway.
        XCTAssertFalse(HostFeatures.widget.contains("workoutPlans"))
        XCTAssertTrue(HostFeatures.widget.isSubset(of: HostFeatures.watch))
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

// ARCH-06 follow-up 3: a WidgetCenter reload wakes the extension and spends
// from the watch's refresh budget, so a republish that lands a payload byte-for-
// byte identical to the stored one except for `publishedAt` — an unchanged
// foreground reconcile, a Storage write no widget reads — must not pay for one.
// Everything else, including any doubt about what the store holds, still does.
final class WidgetPublishGateTests: XCTestCase {
    private static let widgets = """
        {"hydration":{"accessoryCircular":{
          "entries":[{"date":2000,"tree":null,"url":null,"relevance":null}],
          "reloadAfter":null,"relevantContexts":null}}}
        """
    private static let controls = """
        {"hydration.addGlass":
          {"intent":"addGlass","label":"Add Glass","systemName":"drop.fill"}}
        """

    /// The exact wire shape js/src/widgets.ts publishes.
    private func payload(
        v: Int = 1, publishedAt: Double = 1_000, stateRevision: Int = 7,
        releaseId: String = "\"abc123\"",
        widgets: String = WidgetPublishGateTests.widgets,
        controls: String = WidgetPublishGateTests.controls
    ) -> String {
        """
        {"v":\(v),"publishedAt":\(publishedAt),"stateRevision":\(stateRevision),
         "releaseId":\(releaseId),"widgets":\(widgets),"controls":\(controls)}
        """
    }

    func testRepublishThatOnlyRestampsPublishedAtSkipsTheReload() {
        XCTAssertFalse(
            WidgetPublishGate.shouldReload(
                previousJSON: payload(publishedAt: 1_000),
                newJSON: payload(publishedAt: 9_999)),
            "same revision, release, trees and controls — the extension already "
                + "holds this payload")
    }

    func testMovedStateRevisionReloads() {
        // The load-bearing one: the revision is what tells a provider its
        // payload describes state the user has since changed.
        XCTAssertTrue(
            WidgetPublishGate.shouldReload(
                previousJSON: payload(stateRevision: 7),
                newJSON: payload(publishedAt: 2_000, stateRevision: 8)))
    }

    func testChangedReleaseIdReloads() {
        // A new producing bundle can render the same tree DIFFERENTLY once its
        // components are interpreted by the release that made it.
        XCTAssertTrue(
            WidgetPublishGate.shouldReload(
                previousJSON: payload(releaseId: "\"abc123\""),
                newJSON: payload(releaseId: "\"def456\"")))
        // nil on one side is a change too — "producer unknown" is not "same
        // producer" (it is the shipped-bytecode path, ARCH-06).
        XCTAssertTrue(
            WidgetPublishGate.shouldReload(
                previousJSON: payload(releaseId: "null"),
                newJSON: payload(releaseId: "\"abc123\"")))
    }

    func testChangedTimelinesReload() {
        XCTAssertTrue(
            WidgetPublishGate.shouldReload(
                previousJSON: payload(),
                newJSON: payload(
                    widgets: """
                        {"hydration":{"accessoryCircular":{
                          "entries":[{"date":5000,"tree":null,"url":null,"relevance":null}],
                          "reloadAfter":null,"relevantContexts":null}}}
                        """)),
            "a re-dated entry is what the widget draws")
    }

    func testChangedControlsReload() {
        // Controls are metadata, not a timeline — but the Control Center label
        // comes from this map, so a rename that never reloads is a stale label.
        XCTAssertTrue(
            WidgetPublishGate.shouldReload(
                previousJSON: payload(),
                newJSON: payload(
                    controls: """
                        {"hydration.addGlass":
                          {"intent":"addGlass","label":"Add Water","systemName":"drop.fill"}}
                        """)))
    }

    func testChangedWireVersionReloads() {
        XCTAssertTrue(
            WidgetPublishGate.shouldReload(
                previousJSON: payload(v: 1), newJSON: payload(v: 2)))
    }

    func testAnyDoubtReloads() {
        // Fail open toward freshness: a skipped reload leaves a complication
        // showing a number the user already changed; a spurious one costs
        // budget once.
        XCTAssertTrue(
            WidgetPublishGate.shouldReload(previousJSON: nil, newJSON: payload()),
            "nothing published yet")
        XCTAssertTrue(
            WidgetPublishGate.shouldReload(
                previousJSON: "not json", newJSON: payload()),
            "an undecodable stored payload proves nothing about what is shown")
        XCTAssertTrue(
            WidgetPublishGate.shouldReload(
                previousJSON: payload(), newJSON: "not json"),
            "an undecodable new payload is not provably the same publication")
    }

    /// The gate's field list is POSITIVE, so a field added to the codegen-owned
    /// `PublishedWidgets` joins the wire format WITHOUT joining `sameContent` —
    /// and the compiler says nothing (proven: adding one builds clean and every
    /// other test still passes). That silent default is the fail-CLOSED
    /// direction: the new field's changes get classified "publishedAt-only" and
    /// the reload is skipped, leaving the complication showing a number the user
    /// already changed. Pin the shape so the decision is FORCED here — either add
    /// the field to `sameContent` or record why its changes need no wake, then
    /// update this set.
    func testEveryWireFieldIsAccountedForByTheGate() throws {
        let decoded = try JSONDecoder().decode(
            PublishedWidgets.self, from: Data(payload().utf8))
        XCTAssertEqual(
            Set(Mirror(reflecting: decoded).children.compactMap(\.label)),
            [
                "publishedAt",  // deliberately excluded — the whole point
                "v", "stateRevision", "releaseId", "widgets", "controls",
            ],
            "PublishedWidgets gained or lost a field: decide which side of the "
                + "reload question it falls on in WidgetPublishGate.sameContent")
    }

    func testComparesDecodedValuesNotSerializedText() {
        // Two encodings of ONE payload: different key order, different
        // whitespace, a different `publishedAt`. A string compare would call
        // these a change and reload on every publish, which is the whole saving.
        let previous = """
            {"v":1,"publishedAt":1000,"stateRevision":7,"releaseId":"abc123",
             "widgets":{},"controls":{}}
            """
        let new = """
            {"controls":{},"widgets":{},"releaseId":"abc123",
              "stateRevision":7,   "publishedAt":1000.5,  "v":1}
            """
        XCTAssertFalse(
            WidgetPublishGate.shouldReload(previousJSON: previous, newJSON: new))
    }
}

// The Smart Stack predictive clue wire format. `relevantContexts` used to be a
// positional `{date?, latitude?, …}` bag whose only Swift fixture was a literal
// `null` — the whole predictive path decoded nothing in any test. It is now a
// TAGGED UNION (`kind` + that arm's fields only), so what has to be pinned on
// Linux is: every family survives a decode, each arm carries ONLY its own
// fields, and a clue with no family is rejected rather than guessed at.
//
// This is a wire-decode test, deliberately: `reactRelevantContext(from:)` — the
// switch that turns these into RelevanceKit contexts — is `#if os(watchOS)`, so
// the mapping itself is ② at the next Xcode build and the actual Smart Stack
// surfacing is permanently ③.
final class PublishedRelevantContextTests: XCTestCase {
    /// One clue of every kind, in the exact shape `js/src/widgets.ts`
    /// `publishedRelevantContext` emits (absent fields are omitted, not null).
    private static let json = """
        [{"kind":"date","date":1000},
         {"kind":"date","date":2000,"dateKind":"scheduled"},
         {"kind":"dateRange","from":3000,"to":4000,"dateKind":"informational"},
         {"kind":"location","latitude":37.33,"longitude":-122.03,"radius":150},
         {"kind":"location","latitude":1,"longitude":2},
         {"kind":"poi","category":"cafe"},
         {"kind":"inferredLocation","place":"home"},
         {"kind":"fitness","condition":"activityRingsIncomplete"},
         {"kind":"sleep","condition":"bedtime"},
         {"kind":"headphones","condition":"connected"},
         {"kind":"dateRange","from":5000,"to":6000,"dateKind":"urgent"}]
        """

    private func decoded() throws -> [PublishedRelevantContext] {
        try JSONDecoder().decode(
            [PublishedRelevantContext].self,
            from: Data(PublishedRelevantContextTests.json.utf8))
    }

    func testDecodesOneClueOfEveryKind() throws {
        let clues = try decoded()
        XCTAssertEqual(
            clues.map(\.kind),
            [
                "date", "date", "dateRange", "location", "location", "poi",
                "inferredLocation", "fitness", "sleep", "headphones",
                "dateRange",
            ])
    }

    /// `dateKind` is a plain `String?` on the wire and NOTHING on the path
    /// validates it: `publishedRelevantContext` spreads the value through
    /// untouched and TypeScript's `"default"|"informational"|"scheduled"` union
    /// is erased at runtime. So a case typo, an untyped JS caller, or an OTA
    /// bundle newer than this binary reaches Swift with a name it can't map —
    /// which is why `reactRelevantContext`'s `dateRange` arm must DROP such a
    /// clue rather than substitute `.default`. Substituting would re-create the
    /// exact ambiguity the tagged union removed: "field absent" and "field
    /// present but unrecognized" are different statements, and the sibling
    /// `date` arm already separates them.
    ///
    /// Only the wire half is ① here — the mapping itself is `#if os(watchOS)`,
    /// so "urgent" -> nil is ② at the next Xcode build (C6).
    func testAnUnrecognizedDateKindSurvivesTheWireForTheSwitchToDrop() throws {
        let clue = try XCTUnwrap(decoded().last)
        XCTAssertEqual(clue.kind, "dateRange")
        XCTAssertEqual(clue.dateKind, "urgent")
        XCTAssertEqual(clue.from, 5000)
        XCTAssertEqual(clue.to, 6000)
    }

    func testEachArmCarriesOnlyItsOwnFields() throws {
        let clues = try decoded()

        // date: the kind-less watchOS 10.0 form, then the 26.0 form.
        XCTAssertEqual(clues[0].date, 1000)
        XCTAssertNil(clues[0].dateKind)
        XCTAssertNil(clues[0].latitude)
        XCTAssertEqual(clues[1].dateKind, "scheduled")

        // dateRange: from/to, never `date` — the arms must not overlap, or the
        // Swift switch's `date` case would read a range's endpoint as a moment.
        XCTAssertEqual(clues[2].from, 3000)
        XCTAssertEqual(clues[2].to, 4000)
        XCTAssertEqual(clues[2].dateKind, "informational")
        XCTAssertNil(clues[2].date)

        // location: an omitted radius stays nil so Swift applies its 100 m
        // default, rather than the author appearing to have asked for 0.
        XCTAssertEqual(clues[3].radius, 150)
        XCTAssertNil(clues[4].radius)
        XCTAssertEqual(clues[4].latitude, 1)

        XCTAssertEqual(clues[5].category, "cafe")
        XCTAssertNil(clues[5].condition)
        XCTAssertEqual(clues[6].place, "home")
        XCTAssertEqual(clues[7].condition, "activityRingsIncomplete")
        XCTAssertEqual(clues[8].condition, "bedtime")
        XCTAssertEqual(clues[9].condition, "connected")
        XCTAssertNil(clues[9].category)
    }

    /// `kind` is REQUIRED on the wire. A clue with no family can't be mapped to
    /// any RelevanceKit factory, and the old shape's "infer the family from
    /// which fields are set" is exactly what the union replaces — so it must
    /// fail loudly at the decode rather than reach the switch as a shrug.
    func testAClueWithNoKindIsRejected() {
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                PublishedRelevantContext.self,
                from: Data(#"{"date":1000}"#.utf8)))
    }

    /// Positive field list, same reasoning as the publish gate's shape pin: a
    /// payload field added in `codegen/schema.ts` reaches the wire without the
    /// compiler saying anything, and an unread field is a clue family that
    /// silently never surfaces. Adding one here forces the matching arm in
    /// `reactRelevantContext(from:)`.
    func testWireFieldsAreAccountedForByTheSwiftSwitch() throws {
        let clue = try XCTUnwrap(decoded().first)
        XCTAssertEqual(
            Set(Mirror(reflecting: clue).children.compactMap(\.label)),
            [
                "kind", "date", "from", "to", "dateKind", "latitude",
                "longitude", "radius", "category", "place", "condition",
            ],
            "PublishedRelevantContext gained or lost a field: give it an arm "
                + "in reactRelevantContext(from:) or record why it has none")
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

    // OP-1 (shipped-bundle half): the decision `loadShipped` makes about
    // trusting `bundle.qbc` — pinned here since ReactWatchHost itself is
    // watchOS-only and can't run under `swift test`. A stale/hand-swapped
    // `bundle.js` (bit the project twice in one session) must not silently
    // boot bytecode compiled from a DIFFERENT source.
    func testMatchesTrustsOnlyAnEqualStamp() {
        let source = "globalThis.x=1"
        XCTAssertTrue(ContentHash.matches(source: source, stampedHash: ContentHash.of(source)))
    }

    func testMatchesRefusesAMismatchedStamp() {
        XCTAssertFalse(
            ContentHash.matches(
                source: "globalThis.x=1", stampedHash: ContentHash.of("globalThis.x=2")))
    }

    // A missing sidecar (an older build, or a `.qbc` hand-copied without it)
    // is untrusted, not "no opinion" — the permissive read would be exactly
    // the blind-trust bug this function exists to close.
    func testMatchesRefusesAMissingStamp() {
        XCTAssertFalse(ContentHash.matches(source: "globalThis.x=1", stampedHash: nil))
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

    // `isPrivateHost` used to classify by string PREFIX (`hasPrefix("10.")`),
    // so a fully public DNS name that merely starts with a private-looking
    // prefix counted as LAN and got cleartext OTA. Fixed to require the whole
    // host be a dotted-quad literal.
    func testPublicHostsWithPrivateLookingPrefixesAreRefused() {
        for url in [
            "http://10.attacker.com/m.json",
            "http://192.168.evil.com/m.json",
            "http://172.20.evil.com/m.json",
            "http://127.attacker.com/m.json",
        ] {
            XCTAssertNotNil(UpdateURLPolicy.violation(of: url), url)
        }
    }

    // Foundation's URL parser correctly extracts an IPv6 literal's host
    // WITHOUT brackets (`"::1"`), unlike js update.ts's regex-based host
    // extraction, which can never produce that string (it stops at the first
    // `:`) — so js/src/update.ts's `isPrivateHost` can never treat an IPv6
    // literal as private, by construction, regardless of what it checks for.
    // Keeping a Swift-only `host == "::1"` allowance would make the two
    // policies disagree over IPv6 loopback, so it was dropped along with the
    // dead JS branch: neither side special-cases IPv6 literals.
    func testIPv6LoopbackIsRefused() {
        XCTAssertNotNil(UpdateURLPolicy.violation(of: "http://[::1]:8788/m.json"))
        XCTAssertNotNil(UpdateURLPolicy.violation(of: "http://[::1]/m.json"))
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
        XCTAssertEqual(policy.maxTransferFileBytes, 1_048_576)
    }

    func testTransferFileBudgetWarnsAndNamesTheCost() throws {
        // The soft cap on WCSession.transferFile is OURS and provisional —
        // Apple publishes no byte cap — so it must behave like every other
        // ARCH-13 budget: warn, never reject (the handler transfers either
        // way), and warn once per crossing.
        var policy = BudgetPolicy(maxTransferFileBytes: 1000)
        let crossed = policy.check(
            transferFileBytes: 4096, sessionId: "s", target: .watch)
        let diagnostic = try XCTUnwrap(crossed.first)
        XCTAssertEqual(diagnostic.code, "budget.maxTransferFileBytes")
        XCTAssertEqual(diagnostic.severity, .recoverable)
        XCTAssertEqual(diagnostic.subsystem, .budget)
        XCTAssertTrue(
            diagnostic.details?.contains("4096-byte file") == true,
            diagnostic.details ?? "nil")
        // Hysteresis, like every other budget: a second oversize transfer in a
        // row is the same crossing, and a small one re-arms it.
        XCTAssertTrue(
            policy.check(transferFileBytes: 9000, sessionId: "s", target: .watch)
                .isEmpty)
        XCTAssertTrue(
            policy.check(transferFileBytes: 10, sessionId: "s", target: .watch)
                .isEmpty)
        XCTAssertEqual(
            policy.check(transferFileBytes: 4096, sessionId: "s", target: .watch)
                .map(\.code),
            ["budget.maxTransferFileBytes"])
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

/// The HealthKit read contract's decidable half (js/src/health.ts). The queries
/// themselves are `#if os(watchOS)` and unreachable here, so everything a
/// malformed request has to trip lives in `HealthQueryPlan` and is proven on
/// Linux: the per-type unit table, the statistic legality Apple enforces by
/// THROWING at query time, the window rules, and the sample cap.
final class HealthQueryPlanTests: XCTestCase {
    private func window(_ extra: String = "") -> String {
        #"{"startMs":1000,"endMs":2000\#(extra)}"#
    }

    func testUnitsAreFixedPerTypeAndNameSpO2AsAFraction() {
        // The wire unit is chosen natively and only REPORTED to JS, so these
        // strings are the contract a chart labels its axis from.
        XCTAssertEqual(HealthQuantityKind.stepCount.unit, "count")
        XCTAssertEqual(HealthQuantityKind.activeEnergyBurned.unit, "kcal")
        XCTAssertEqual(HealthQuantityKind.distanceWalkingRunning.unit, "m")
        XCTAssertEqual(HealthQuantityKind.heartRate.unit, "count/min")
        // "fraction", never "percent": HKUnit.percent() yields 0…1, and calling
        // it percent is how a caller multiplies by 100 twice.
        XCTAssertEqual(HealthQuantityKind.oxygenSaturation.unit, "fraction")
    }

    func testOnlySumIsLegalForACumulativeType() {
        // HKStatisticsOptions' halves are mutually exclusive per type and the
        // wrong pairing throws — this is the rule that turns that throw into an
        // INVALID_REQUEST the caller can act on.
        XCTAssertTrue(HealthStatistic.sum.isLegal(for: .stepCount))
        XCTAssertFalse(HealthStatistic.average.isLegal(for: .stepCount))
        XCTAssertFalse(HealthStatistic.mostRecent.isLegal(for: .stepCount))
        XCTAssertFalse(HealthStatistic.sum.isLegal(for: .heartRate))
        XCTAssertTrue(HealthStatistic.average.isLegal(for: .heartRate))
        XCTAssertTrue(HealthStatistic.max.isLegal(for: .oxygenSaturation))
    }

    func testStatisticsPlanDecodesALegalRequest() {
        let plan = try? HealthStatisticsPlan.decode(
            json: #"{"type":"stepCount","statistic":"sum","startMs":1000,"endMs":2000}"#
        ).get()
        XCTAssertEqual(plan?.kind, .stepCount)
        XCTAssertEqual(plan?.statistic, .sum)
        XCTAssertEqual(plan?.window.startMs, 1000)
        XCTAssertEqual(plan?.window.endMs, 2000)
    }

    func testStatisticsPlanRejectsAnIllegalPairingBeforeQuerying() {
        let result = HealthStatisticsPlan.decode(
            json: #"{"type":"stepCount","statistic":"average","startMs":1000,"endMs":2000}"#
        )
        guard case .failure(let error) = result else {
            return XCTFail("average over a cumulative type must be rejected")
        }
        // The message has to name the rule: a caller cannot read Apple's
        // per-type statistics matrix out of a bare "bad request".
        XCTAssertTrue(error.message.contains("not valid for"))
        XCTAssertTrue(error.message.contains("stepCount"))
    }

    func testStatisticsPlanRejectsUnknownTypeAndStatistic() {
        XCTAssertNil(
            try? HealthStatisticsPlan.decode(
                json: #"{"type":"steps","statistic":"sum","startMs":1,"endMs":2}"#
            ).get())
        XCTAssertNil(
            try? HealthStatisticsPlan.decode(
                json: #"{"type":"stepCount","statistic":"median","startMs":1,"endMs":2}"#
            ).get())
    }

    func testWindowRejectsAnInvertedOrEmptyRange() {
        // An inverted range would resolve an EMPTY result, which a caller
        // cannot tell from "no data" — the one answer this API must not fake.
        XCTAssertNil(
            try? HealthWindow.decode(startMs: 2000, endMs: 1000, limit: nil).get())
        XCTAssertNil(
            try? HealthWindow.decode(startMs: 1000, endMs: 1000, limit: nil).get())
        XCTAssertNil(
            try? HealthWindow.decode(startMs: nil, endMs: 1000, limit: nil).get())
        XCTAssertNil(
            try? HealthWindow.decode(
                startMs: .nan, endMs: 1000, limit: nil
            ).get())
    }

    func testWindowClampsTheSampleLimitAndRejectsANonPositiveOne() {
        // Every sample crosses the bridge as JSON on a memory-tight watch, so
        // an un-capped year of heart rate is an OOM kill, not a slow query.
        let clamped = try? HealthWindow.decode(
            startMs: 1, endMs: 2, limit: 100_000
        ).get()
        XCTAssertEqual(clamped?.limit, HealthWindow.maxLimit)
        let kept = try? HealthWindow.decode(startMs: 1, endMs: 2, limit: 7).get()
        XCTAssertEqual(kept?.limit, 7)
        XCTAssertNil(
            try? HealthWindow.decode(startMs: 1, endMs: 2, limit: 0).get())
    }

    func testADailyBucketBelongsToTheWindowItStartsInside() {
        // The off-by-one Apple's own contract introduces, and the reason this
        // rule is code: enumerateStatistics(from:to:) calls its block for "the
        // time interval that CONTAINS the end date", so a week chart over
        // [midnight, midnight + 7d) gets an eighth bucket starting exactly at
        // endMs. Seven days in has to mean seven buckets out, or every caller
        // re-derives the trim.
        let day = 86_400_000.0
        let window = try? HealthWindow.decode(
            startMs: 0, endMs: 7 * day, limit: nil
        ).get()
        XCTAssertEqual(window?.containsBucketStart(0), true)
        XCTAssertEqual(window?.containsBucketStart(6 * day), true)
        // The boundary bucket: it STARTS where the window ends, so it is the
        // eighth day of a seven-day question.
        XCTAssertEqual(window?.containsBucketStart(7 * day), false)
        XCTAssertEqual(window?.containsBucketStart(-day), false)
    }

    func testDailyPlanRefusesAWindowWiderThanTheBucketCeiling() {
        // REFUSED, not clamped, unlike `limit`: a truncated series is a chart
        // that lies about the range it was asked for. And the ceiling is the
        // sample ceiling — a bucket costs the wire what a sample does, so there
        // is one number here, not two rules to learn.
        let day = 86_400_000.0
        let ok = try? HealthStatisticsPlan.decodeDaily(
            json: #"{"type":"stepCount","statistic":"sum","startMs":0,"endMs":604800000}"#
        ).get()
        XCTAssertEqual(ok?.window.dayCount, 7)
        let past = Int(Double(HealthWindow.maxDailyBuckets + 1) * day)
        let tooWide = HealthStatisticsPlan.decodeDaily(
            json: #"{"type":"stepCount","statistic":"sum","startMs":0,"endMs":\#(past)}"#
        )
        guard case .failure(let error) = tooWide else {
            return XCTFail("a window past the bucket ceiling must be refused")
        }
        XCTAssertTrue(error.message.contains("ceiling"))
        // A partial day still counts as a bucket, so the count rounds UP.
        let partial = try? HealthWindow.decode(
            startMs: 0, endMs: day + 1, limit: nil
        ).get()
        XCTAssertEqual(partial?.dayCount, 2)
    }

    func testDailyPlanRefusesAnAbsurdWindowInsteadOfTrapping() {
        // `decode` only promises the two ends are finite and ordered, and JS
        // hands over any `number` unvalidated — so a window can span more days
        // than `Int` can hold, and two finite ends can even subtract to `+inf`.
        // Both must come back as INVALID_REQUEST like every sibling decoder,
        // not as a fatalError that aborts the app on the invoke path.
        for json in [
            #"{"type":"stepCount","statistic":"sum","startMs":0,"endMs":1e300}"#,
            #"{"type":"stepCount","statistic":"sum","startMs":-1.7e308,"endMs":1.7e308}"#,
        ] {
            guard case .failure(let error) = HealthStatisticsPlan.decodeDaily(json: json)
            else {
                return XCTFail("an absurd window must be refused, not accepted")
            }
            XCTAssertTrue(error.message.contains("ceiling"))
        }
    }

    func testDailyPlanKeepsEveryRuleTheScalarQueryHas() {
        // Chopping the window into buckets does not change which statistics
        // HealthKit will compute for a type — the pairing still throws — so the
        // bucketed decoder must not become a second, laxer door.
        XCTAssertNil(
            try? HealthStatisticsPlan.decodeDaily(
                json: #"{"type":"stepCount","statistic":"average","startMs":0,"endMs":1}"#
            ).get())
        XCTAssertNil(
            try? HealthStatisticsPlan.decodeDaily(
                json: #"{"type":"stepCount","statistic":"sum","startMs":2,"endMs":1}"#
            ).get())
    }

    func testSamplesAndSleepPlansShareTheWindowRules() {
        let samples = try? HealthSamplesPlan.decode(
            json: #"{"type":"heartRate","startMs":1000,"endMs":2000,"limit":5}"#
        ).get()
        XCTAssertEqual(samples?.kind, .heartRate)
        XCTAssertEqual(samples?.window.limit, 5)
        let sleep = try? SleepSamplesPlan.decode(json: window()).get()
        XCTAssertEqual(sleep?.window.endMs, 2000)
        XCTAssertNil(
            try? SleepSamplesPlan.decode(
                json: #"{"startMs":2000,"endMs":1000}"#
            ).get())
    }

    func testAuthorizationPlanNeedsAtLeastOneTypeAndRejectsUnknownNames() {
        let both = try? HealthAuthorizationPlan.decode(
            json: #"{"read":["stepCount","heartRate"],"sleep":true}"#
        ).get()
        XCTAssertEqual(both?.kinds, [.stepCount, .heartRate])
        XCTAssertEqual(both?.sleep, true)
        // Sleep alone is legitimate: it is a CATEGORY type and cannot ride the
        // quantity `read` list.
        XCTAssertNotNil(
            try? HealthAuthorizationPlan.decode(
                json: #"{"read":[],"sleep":true}"#
            ).get())
        // An empty ask would run the sheet for nothing.
        XCTAssertNil(
            try? HealthAuthorizationPlan.decode(json: #"{"read":[]}"#).get())
        XCTAssertNil(
            try? HealthAuthorizationPlan.decode(
                json: #"{"read":["bloodGlucose"]}"#
            ).get())
    }

    func testStagesAreTheSixWireNames() {
        // The bridge maps HKCategoryValueSleepAnalysis by CASE, never by raw
        // value (Apple does not document the integers), so this pins only the
        // vocabulary — codegen.test.ts pins it against the schema union.
        XCTAssertEqual(
            SleepStage.allCases.map(\.rawValue),
            [
                "inBed", "awake", "asleepCore", "asleepDeep", "asleepREM",
                "asleepUnspecified",
            ])
    }
}

/// The workout-control contract's decidable half (js/src/workout.ts). The
/// session owner is `#if os(watchOS)` and unreachable here, so what is proven
/// on Linux is the request validation + the metrics-interval battery knob.
/// The activity NAME is deliberately not validated here: the only truthful
/// check is "does this binary's HKWorkoutActivityType have that case", which
/// lives in the generated switch (pinned by codegen.test.ts).
final class WorkoutPlanTests: XCTestCase {
    func testDecodesAFullRequest() {
        let plan = try? WorkoutStartPlan.decode(
            json: #"""
                {"activityType":"running","location":"outdoor",
                 "metricsIntervalMs":2000,"collectRoute":true}
                """#
        ).get()
        XCTAssertEqual(plan?.activityType, "running")
        XCTAssertEqual(plan?.location, .outdoor)
        XCTAssertEqual(plan?.metricsIntervalMs, 2000)
        XCTAssertEqual(plan?.collectRoute, true)
    }

    func testDefaultsAreTheBatterySafeOnes() {
        let plan = try? WorkoutStartPlan.decode(
            json: #"{"activityType":"yoga"}"#
        ).get()
        // No location = HealthKit's own default (unknown), no route = no GPS,
        // and a 1 s metrics period rather than one push per collected sample.
        XCTAssertNil(plan?.location)
        XCTAssertEqual(plan?.collectRoute, false)
        XCTAssertEqual(
            plan?.metricsIntervalMs, WorkoutStartPlan.defaultMetricsIntervalMs)
    }

    func testMetricsIntervalHasAFloor() {
        // Every push crosses the bridge and can commit a render; a 0 would ask
        // for one per collected sample for the whole workout.
        let plan = try? WorkoutStartPlan.decode(
            json: #"{"activityType":"running","metricsIntervalMs":0}"#
        ).get()
        XCTAssertEqual(
            plan?.metricsIntervalMs, WorkoutStartPlan.minMetricsIntervalMs)
    }

    func testRejectsAMissingActivityAndAnUnknownLocation() {
        XCTAssertNil(try? WorkoutStartPlan.decode(json: "{}").get())
        XCTAssertNil(
            try? WorkoutStartPlan.decode(
                json: #"{"activityType":""}"#
            ).get())
        guard
            case .failure(let error) = WorkoutStartPlan.decode(
                json: #"{"activityType":"running","location":"poolside"}"#)
        else { return XCTFail("an unknown location must be rejected") }
        XCTAssertTrue(error.message.contains("indoor"))
    }

    func testARecoveredSessionTakesTheDefaultsItCannotKnow() {
        // A workout recovered after a crash has no wire payload behind it: the
        // request died with the process, and the HKWorkoutConfiguration is all
        // that survived. The two knobs a caller would have chosen are decided
        // here rather than in the watchOS-only owner, so they are provable.
        let plan = WorkoutStartPlan.recovered(
            activityType: "running", location: .outdoor)
        XCTAssertEqual(plan.activityType, "running")
        XCTAssertEqual(plan.location, .outdoor)
        // The crashed launch's period is unknowable; the default is the
        // battery-safe end of the range.
        XCTAssertEqual(plan.metricsIntervalMs, WorkoutStartPlan.defaultMetricsIntervalMs)
        // The load-bearing one: a route resumed here would begin wherever the
        // app relaunched and look complete, which is worse than no route.
        XCTAssertFalse(plan.collectRoute)
        // An unknown location is legitimate — HKWorkoutConfiguration's own
        // default is `.unknown`, which has no wire name.
        XCTAssertNil(
            WorkoutStartPlan.recovered(activityType: "yoga", location: nil).location)
    }

    func testEndReasonsIncludeTheOneNoCallerCanCause() {
        // `runtimeReload` is what a dev reload / OTA apply reports: the fresh
        // runtime never started that workout, and this is how it finds out the
        // previous one was ended AND saved for it.
        XCTAssertEqual(
            WorkoutEndReason.allCases.map(\.rawValue),
            ["requested", "discarded", "runtimeReload", "failed"])
    }
}

/// WorkoutKit plan validation (js/src/workoutPlans.ts). The bridge that builds
/// the real `CustomWorkout`/`WorkoutPlan` is `#if os(watchOS)` and unreachable
/// here, so this is the whole in-repo proof that a malformed plan is REFUSED —
/// and refused with a message naming the element that failed, because
/// `WorkoutScheduler.schedule` has no error channel and would otherwise
/// swallow it.
final class WorkoutPlanSpecTests: XCTestCase {
    /// A custom plan with a warmup, one block and a cooldown.
    private func customJSON(
        blocks: String = #"""
        [{"iterations":6,"steps":[
          {"purpose":"work","goal":{"kind":"distance","meters":400},
           "alert":{"kind":"heartRateRange","lowerBpm":150,"upperBpm":170}},
          {"purpose":"recovery","goal":{"kind":"time","seconds":90}}]}]
        """#
    ) -> String {
        #"""
        {"plan":{"kind":"custom","id":"3F2504E0-4F89-41D3-9A0C-0305E82C3301",
         "activityType":"running","location":"outdoor","displayName":"6 × 400m",
         "warmup":{"goal":{"kind":"time","seconds":600}},
         "blocks":\#(blocks),
         "cooldown":{"goal":{"kind":"open"}}},
         "atMs":1768476600000}
        """#
    }

    func testDecodesAFullCustomPlan() {
        guard
            case .success(let spec) = WorkoutPlanScheduleSpec.decode(
                json: customJSON())
        else { return XCTFail("a full custom plan must decode") }
        XCTAssertEqual(spec.plan.kind, .custom)
        XCTAssertEqual(
            spec.plan.id, UUID(uuidString: "3F2504E0-4F89-41D3-9A0C-0305E82C3301"))
        XCTAssertTrue(spec.plan.idWasSupplied)
        XCTAssertEqual(spec.plan.activityType, "running")
        XCTAssertEqual(spec.plan.location, .outdoor)
        XCTAssertEqual(spec.plan.displayName, "6 × 400m")
        XCTAssertEqual(spec.plan.warmup?.goal?.kind, .time)
        XCTAssertEqual(spec.plan.warmup?.goal?.value, 600)
        XCTAssertEqual(spec.plan.blocks.count, 1)
        XCTAssertEqual(spec.plan.blocks.first?.iterations, 6)
        XCTAssertEqual(spec.plan.blocks.first?.steps.count, 2)
        XCTAssertEqual(spec.plan.blocks.first?.steps.first?.purpose, .work)
        XCTAssertEqual(
            spec.plan.blocks.first?.steps.first?.step.alert?.kind, .heartRateRange)
        XCTAssertEqual(spec.plan.blocks.first?.steps.first?.step.alert?.lower, 150)
        XCTAssertEqual(spec.plan.blocks.first?.steps.first?.step.alert?.upper, 170)
        XCTAssertEqual(spec.plan.cooldown?.goal?.kind, .open)
        XCTAssertNil(spec.plan.cooldown?.goal?.value)
        XCTAssertEqual(spec.atMs, 1_768_476_600_000)
    }

    func testAnOmittedIdIsMintedAndAnInvalidOneIsRefused() {
        // The silent-substitution bug this rejection exists to prevent:
        // schedule/list/remove all key on the id, so a non-UUID quietly
        // becoming a fresh random one makes removal a permanent no-op the
        // caller cannot see.
        guard
            case .success(let spec) = WorkoutPlanScheduleSpec.decode(
                json: #"""
                    {"plan":{"kind":"singleGoal","activityType":"cycling",
                     "goal":{"kind":"energy","kilocalories":400}},
                     "atMs":1768476600000}
                    """#)
        else { return XCTFail("an id-less plan must decode") }
        XCTAssertFalse(spec.plan.idWasSupplied)
        guard
            case .failure(let error) = WorkoutPlanScheduleSpec.decode(
                json: #"""
                    {"plan":{"kind":"singleGoal","id":"plan-1",
                     "activityType":"cycling","goal":{"kind":"open"}},
                     "atMs":1768476600000}
                    """#)
        else { return XCTFail("a non-UUID id must be refused") }
        XCTAssertTrue(error.message.contains("plan.id"))
        XCTAssertTrue(error.message.contains("is not a UUID"))
    }

    func testACustomPlanNeedsAtLeastOneBlock() {
        // TrainingPeaks rejects unstructured plans outright, and a custom
        // workout with no blocks is a singleGoal wearing the wrong kind.
        for blocks in ["[]", "null"] {
            guard
                case .failure(let error) = WorkoutPlanScheduleSpec.decode(
                    json: customJSON(blocks: blocks))
            else { return XCTFail("a block-less custom plan must be refused") }
            XCTAssertTrue(error.message.contains("plan.blocks"))
            XCTAssertTrue(error.message.contains("singleGoal"))
        }
    }

    func testRefusesEmptyStepsAndZeroIterations() {
        guard
            case .failure(let steps) = WorkoutPlanScheduleSpec.decode(
                json: customJSON(blocks: #"[{"steps":[]}]"#))
        else { return XCTFail("a step-less block must be refused") }
        XCTAssertTrue(steps.message.contains("plan.blocks[0].steps"))
        guard
            case .failure(let iterations) = WorkoutPlanScheduleSpec.decode(
                json: customJSON(
                    blocks: #"[{"iterations":0,"steps":[{"purpose":"work"}]}]"#))
        else { return XCTFail("0 iterations must be refused") }
        XCTAssertTrue(iterations.message.contains("iterations"))
    }

    func testTheRejectionNamesTheFailingPath() {
        // The whole point of validating here rather than letting Apple's
        // non-throwing scheduler swallow it: a caller must be able to find the
        // element, not just learn "bad request".
        guard
            case .failure(let error) = WorkoutPlanScheduleSpec.decode(
                json: customJSON(
                    blocks: #"""
                        [{"steps":[{"purpose":"work"},
                          {"purpose":"recovery",
                           "alert":{"kind":"heartRateRange","lowerBpm":180,
                                    "upperBpm":120}}]}]
                        """#))
        else { return XCTFail("an inverted range must be refused") }
        XCTAssertTrue(
            error.message.contains("plan.blocks[0].steps[1].alert.lowerBpm"),
            "the message must name the path, got: \(error.message)")
    }

    func testAWrongTypeIsNamedByPathNotBlamedOnTheEnvelope() {
        // The path contract must survive a WRONG TYPE, not just a wrong value.
        // Decoding with `try?` dropped the DecodingError's codingPath, so a
        // string in any leaf came back as "needs a { plan, atMs } object" — a
        // message that is FALSE (the envelope is well-formed) and points at the
        // wrong level of the payload. A text field wired straight into `meters`
        // is the commonest real mistake and never reaches `positive()`.
        for (json, expected) in [
            (
                #"""
                {"plan":{"kind":"singleGoal","activityType":"running",
                 "goal":{"kind":"distance","meters":"400"}},
                 "atMs":1768476600000}
                """#, "plan.goal.meters"
            ),
            (
                customJSON(
                    blocks: #"""
                        [{"steps":[{"purpose":"work"}]},{"steps":[{"purpose":"work"}]},
                         {"steps":[{"purpose":"work","alert":{"kind":"heartRateRange",
                          "lowerBpm":120,"upperBpm":"180"}}]}]
                        """#), "plan.blocks[2].steps[0].alert.upperBpm"
            ),
            (
                #"""
                {"plan":{"kind":"custom","activityType":"running","blocks":{}},
                 "atMs":1768476600000}
                """#, "plan.blocks"
            ),
        ] {
            guard case .failure(let error) = WorkoutPlanScheduleSpec.decode(json: json)
            else { return XCTFail("a wrong type must be refused") }
            XCTAssertTrue(
                error.message.contains(expected),
                "expected \(expected) in: \(error.message)")
            XCTAssertFalse(
                error.message.contains("needs a { plan, atMs } object"),
                "a well-formed envelope must not be blamed: \(error.message)")
        }
        // A body that genuinely is NOT a { plan, atMs } object still gets the
        // envelope message — the path renderer must not swallow that case.
        for json in ["[1,2,3]", "{}", "not json"] {
            guard case .failure(let error) = WorkoutPlanScheduleSpec.decode(json: json)
            else { return XCTFail("\(json) must be refused") }
            XCTAssertTrue(
                error.message.contains("needs a { plan, atMs } object"),
                "expected the envelope message for \(json), got: \(error.message)")
        }
    }

    func testRefusesAFieldThatBelongsToAnotherKind() {
        // The flat wire shape has a `kind` discriminator and optional
        // siblings, so nothing structural stops a caller sending `goal` on a
        // pacer. Ignoring it would build a workout the caller did not describe.
        guard
            case .failure(let error) = WorkoutPlanScheduleSpec.decode(
                json: #"""
                    {"plan":{"kind":"pacer","activityType":"running",
                     "distanceMeters":5000,"durationSeconds":1500,
                     "goal":{"kind":"open"}},"atMs":1768476600000}
                    """#)
        else { return XCTFail("a foreign field must be refused") }
        XCTAssertTrue(error.message.contains("plan.goal"))
        XCTAssertTrue(error.message.contains("singleGoal"))
    }

    func testEachKindRequiresItsOwnFields() {
        // pacer without its two measurements, and singleGoal without a goal.
        for (json, expected) in [
            (
                #"""
                {"plan":{"kind":"pacer","activityType":"running",
                 "durationSeconds":1500},"atMs":1768476600000}
                """#, "plan.distanceMeters"
            ),
            (
                #"""
                {"plan":{"kind":"singleGoal","activityType":"cycling"},
                 "atMs":1768476600000}
                """#, "plan.goal"
            ),
        ] {
            guard case .failure(let error) = WorkoutPlanScheduleSpec.decode(json: json)
            else { return XCTFail("\(expected) must be required") }
            XCTAssertTrue(
                error.message.contains(expected),
                "expected \(expected) in: \(error.message)")
        }
    }

    func testGoalValuesMustBeFiniteAndPositive() {
        // A zero-distance goal is a workout that is complete before it starts,
        // which Apple would accept silently.
        for value in ["0", "-1"] {
            guard
                case .failure = WorkoutPlanScheduleSpec.decode(
                    json: #"""
                        {"plan":{"kind":"singleGoal","activityType":"running",
                         "goal":{"kind":"distance","meters":\#(value)}},
                         "atMs":1768476600000}
                        """#)
            else { return XCTFail("meters \(value) must be refused") }
        }
    }

    func testZonesAreOneBasedAndTheSpeedMetricIsSpeedOnly() {
        guard
            case .failure(let zone) = WorkoutPlanScheduleSpec.decode(
                json: customJSON(
                    blocks: #"""
                        [{"steps":[{"purpose":"work",
                          "alert":{"kind":"heartRateZone","zone":0}}]}]
                        """#))
        else { return XCTFail("zone 0 must be refused") }
        XCTAssertTrue(zone.message.contains("zone"))
        // The 10.4 power selector is cut, so asking for it on a power alert
        // must fail loudly rather than be dropped — a caller that asked for
        // average power and got current would never learn.
        guard
            case .failure(let metric) = WorkoutPlanScheduleSpec.decode(
                json: customJSON(
                    blocks: #"""
                        [{"steps":[{"purpose":"work",
                          "alert":{"kind":"powerThreshold","watts":240,
                                   "metric":"average"}}]}]
                        """#))
        else { return XCTFail("a power metric must be refused") }
        XCTAssertTrue(metric.message.contains("metric"))
        XCTAssertTrue(metric.message.contains("10.0"))
    }

    func testPurposeIsRequiredInsideABlockAndRefusedOutsideOne() {
        guard
            case .failure(let missing) = WorkoutPlanScheduleSpec.decode(
                json: customJSON(blocks: #"[{"steps":[{"goal":{"kind":"open"}}]}]"#))
        else { return XCTFail("a purpose-less interval step must be refused") }
        XCTAssertTrue(missing.message.contains("purpose"))
        guard
            case .failure(let stray) = WorkoutPlanScheduleSpec.decode(
                json: #"""
                    {"plan":{"kind":"custom","activityType":"running",
                     "warmup":{"purpose":"work"},
                     "blocks":[{"steps":[{"purpose":"work"}]}]},
                     "atMs":1768476600000}
                    """#)
        else { return XCTFail("a purpose outside a block must be refused") }
        XCTAssertTrue(stray.message.contains("plan.warmup.purpose"))
    }

    func testRemoveNeedsAUUIDAndAFiniteInstant() {
        guard
            case .success(let ref) = ScheduledWorkoutRefSpec.decode(
                json: #"""
                    {"id":"3F2504E0-4F89-41D3-9A0C-0305E82C3301",
                     "atMs":1768476600000}
                    """#)
        else { return XCTFail("a well-formed ref must decode") }
        XCTAssertEqual(ref.atMs, 1_768_476_600_000)
        XCTAssertNil(
            try? ScheduledWorkoutRefSpec.decode(
                json: #"{"id":"nope","atMs":1768476600000}"#
            ).get())
        XCTAssertNil(
            try? ScheduledWorkoutRefSpec.decode(
                json: #"{"id":"3F2504E0-4F89-41D3-9A0C-0305E82C3301"}"#
            ).get())
    }

    func testTheOpenEnvelopeIsThePlanAlone() {
        guard
            case .success(let spec) = WorkoutPlanSpec.decodeOpen(
                json: #"""
                    {"plan":{"kind":"pacer","activityType":"running",
                     "distanceMeters":5000,"durationSeconds":1500}}
                    """#)
        else { return XCTFail("an open payload must decode") }
        XCTAssertEqual(spec.kind, .pacer)
        XCTAssertEqual(spec.distanceMeters, 5000)
        XCTAssertEqual(spec.durationSeconds, 1500)
        XCTAssertNil(try? WorkoutPlanSpec.decodeOpen(json: "{}").get())
    }
}

/// The `atMs` <-> `DateComponents` round trip — the one part of this family
/// that is genuinely Linux-provable, which is exactly why the conversion is a
/// pure pair taking its `Calendar` as a parameter instead of being written
/// inline in the watchOS-only bridge against `Calendar.current`.
final class WorkoutPlanScheduleTests: XCTestCase {
    /// A fixed calendar, so the test does not depend on where it runs.
    private func calendar(_ secondsFromGMT: Int = 0) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: secondsFromGMT) ?? .gmt
        return calendar
    }

    func testRoundTripsAnInstantThroughTheComponentsTheSchedulerKeysOn() {
        let calendar = calendar()
        // 2026-01-15T11:30:00Z
        let ms: Double = 1_768_476_600_000
        let components = WorkoutPlanSchedule.components(fromMs: ms, calendar: calendar)
        XCTAssertEqual(components.year, 2026)
        XCTAssertEqual(components.month, 1)
        XCTAssertEqual(components.day, 15)
        XCTAssertEqual(components.hour, 11)
        XCTAssertEqual(components.minute, 30)
        XCTAssertEqual(
            WorkoutPlanSchedule.milliseconds(from: components, calendar: calendar), ms)
    }

    func testGranularityIsOneMinute() {
        // Documented, and the reason `remove` matches `schedule` by
        // construction: a caller who schedules at …:30.500 lists …:30.000.
        let calendar = calendar()
        let exact: Double = 1_768_476_600_000
        for offset in [0.0, 500, 30_000, 59_999] {
            XCTAssertEqual(
                WorkoutPlanSchedule.minuteMs(fromMs: exact + offset, calendar: calendar),
                exact,
                "\(offset) ms past the minute must land on the same minute")
        }
        // ...and the next minute is a different key.
        XCTAssertEqual(
            WorkoutPlanSchedule.minuteMs(fromMs: exact + 60_000, calendar: calendar),
            exact + 60_000)
    }

    func testTheComponentSetIsExactlyTheSchedulingFields() {
        // Fixed at year..minute. A wider set would make `remove` miss (seconds
        // never match); a narrower one would collide two plans an hour apart.
        XCTAssertEqual(
            WorkoutPlanSchedule.fields, [.year, .month, .day, .hour, .minute])
        let components = WorkoutPlanSchedule.components(
            fromMs: 1_768_476_630_500, calendar: calendar())
        XCTAssertNil(components.second)
        XCTAssertNil(components.nanosecond)
    }

    func testTheCalendarIsAPARAMETERSoTheSameInstantMovesWithTheZone() {
        // The reason `Calendar` is passed in: the components are wall-clock,
        // so the same instant is a different (day, hour) in another zone —
        // which is exactly what a device-local scheduler means. Reading
        // `Calendar.current` inside the helper would make this untestable.
        let ms: Double = 1_768_476_600_000
        let utc = WorkoutPlanSchedule.components(fromMs: ms, calendar: calendar())
        let plusThree = WorkoutPlanSchedule.components(
            fromMs: ms, calendar: calendar(3 * 3600))
        XCTAssertEqual(utc.hour, 11)
        XCTAssertEqual(plusThree.hour, 14)
        // Each round-trips within its OWN calendar, which is the invariant the
        // bridge relies on when it compares a stored entry against a request.
        XCTAssertEqual(
            WorkoutPlanSchedule.milliseconds(from: plusThree, calendar: calendar(3 * 3600)),
            ms)
    }

    func testAStoredZoneOrCalendarCannotMOVETheInstantTheBridgeMatchesOn() {
        // The read-back in WorkoutPlanBridge.matches compares `minuteMs` of the
        // REQUESTED atMs against `milliseconds(from:)` of Apple's stored
        // components, precisely because Apple may normalise what it stores
        // ("an era, a calendar, a time zone we never set"). Two of those three
        // are inert under `Calendar.date(from:)` — a `timeZone` is NOT: it wins
        // over the calendar's own, so an entry that came back tagged UTC would
        // convert five hours off in New York and every comparison would fail.
        // That is a schedule() falsely reporting "the scheduler accepted
        // nothing" for a plan that landed, a remove() reporting `false` for a
        // plan that is there, and a list reporting every atMs shifted.
        var newYork = Calendar(identifier: .gregorian)
        newYork.timeZone = TimeZone(identifier: "America/New_York")!
        let ms: Double = 1_768_476_600_000
        let asked = WorkoutPlanSchedule.minuteMs(fromMs: ms, calendar: newYork)
        XCTAssertEqual(asked, ms)

        var stored = WorkoutPlanSchedule.components(fromMs: ms, calendar: newYork)
        // Nothing we build ever carries these — only a normalisation would.
        XCTAssertNil(stored.timeZone)
        XCTAssertNil(stored.calendar)
        XCTAssertNil(stored.era)

        stored.timeZone = TimeZone(identifier: "UTC")!
        stored.era = 1
        stored.second = 0
        var tokyo = Calendar(identifier: .gregorian)
        tokyo.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        stored.calendar = tokyo
        XCTAssertEqual(
            WorkoutPlanSchedule.milliseconds(from: stored, calendar: newYork), asked,
            "a normalised entry must still resolve to the minute we asked for")
    }

    func testRefusesANonFiniteOrAbsurdInstant() {
        // `Date(timeIntervalSince1970:)` accepts any finite Double, and handing
        // a 1e300 one to Calendar is a crash on the invoke dispatch path rather
        // than the refusal every other rule in this family produces.
        for atMs in ["null", "1e300"] {
            XCTAssertNil(
                try? ScheduledWorkoutRefSpec.decode(
                    json: #"""
                        {"id":"3F2504E0-4F89-41D3-9A0C-0305E82C3301","atMs":\#(atMs)}
                        """#
                ).get(),
                "atMs \(atMs) must be refused")
        }
    }
}

/// CMPedometer's wire shape (js/src/sensors.ts startPedometer / queryPedometer).
/// The assembly rule is here rather than in the watchOS bridge precisely so it
/// is provable on Linux: what gets OMITTED is the whole contract, and a
/// zero-filled field would be indistinguishable from a real zero.
final class PedometerReadingTests: XCTestCase {
    func testOmitsUnavailableFieldsInsteadOfZeroFilling() {
        // A watch with no altimeter reports NO floors — not 0 floors. Zero
        // would read as "you climbed nothing", which is a different claim.
        let payload = PedometerReading(
            startMs: 1000, endMs: 2000, steps: 500
        ).payload()
        XCTAssertEqual(payload.keys.sorted(), ["endMs", "startMs", "steps"])
        XCTAssertEqual(payload["steps"] as? Double, 500)
    }

    func testCarriesEveryDeclaredFieldWhenAvailable() {
        let payload = PedometerReading(
            startMs: 1000, endMs: 2000, steps: 500, distanceMeters: 410.5,
            floorsAscended: 3, floorsDescended: 2,
            currentPaceSecPerMeter: 0.42, currentCadenceStepsPerSec: 1.85,
            averageActivePaceSecPerMeter: 0.51
        ).payload()
        XCTAssertEqual(
            payload.keys.sorted(),
            [
                "averageActivePaceSecPerMeter", "currentCadenceStepsPerSec",
                "currentPaceSecPerMeter", "distanceMeters", "endMs",
                "floorsAscended", "floorsDescended", "startMs", "steps",
            ])
        // The units are in the NAMES because Apple's are counter-intuitive:
        // currentPace is seconds per METRE and cadence is steps per SECOND.
        XCTAssertEqual(payload["currentPaceSecPerMeter"] as? Double, 0.42)
        XCTAssertEqual(payload["currentCadenceStepsPerSec"] as? Double, 1.85)
    }

    func testQueryPlanRejectsAnInvertedOrNonFiniteWindow() {
        XCTAssertNotNil(
            try? PedometerQueryPlan.decode(
                json: #"{"startMs":1000,"endMs":2000}"#
            ).get())
        XCTAssertNil(
            try? PedometerQueryPlan.decode(
                json: #"{"startMs":2000,"endMs":1000}"#
            ).get())
        XCTAssertNil(try? PedometerQueryPlan.decode(json: #"{"startMs":1000}"#).get())
        XCTAssertNil(try? PedometerQueryPlan.decode(json: "not json").get())
    }
}

/// The EventKit read contract's decidable half (js/src/calendar.ts). The
/// queries are `#if os(watchOS)` and unreachable here, so everything a
/// malformed request has to trip lives in `CalendarPlan` and is proven on
/// Linux: the entity vocabulary, the window rules, the result cap, and the
/// authorization vocabulary's one load-bearing property — that exactly one
/// status can read.
final class CalendarPlanTests: XCTestCase {
    func testOnlyFullAccessCanRead() {
        // Apple: "Your app can't request read-only access to either events or
        // reminders. To read events or reminders from the event store, your app
        // needs full access." `writeOnly` is a REAL watchOS 10 state that also
        // cannot read — and is deliberately NOT collapsed into `denied`,
        // because the two mean opposite things to the person who chose them.
        XCTAssertEqual(CalendarAccess.allCases.filter(\.canRead), [.granted])
        XCTAssertNotEqual(CalendarAccess.writeOnly, .denied)
        XCTAssertFalse(CalendarAccess.writeOnly.canRead)
    }

    func testAccessRejectsAnUnknownEntity() throws {
        XCTAssertEqual(
            try CalendarAccessPlan.decode(json: #"{"entity":"events"}"#).get().entity,
            .events)
        XCTAssertEqual(
            try CalendarAccessPlan.decode(json: #"{"entity":"reminders"}"#).get()
                .entity,
            .reminders)
        // An unbound entity would prompt for nothing and resolve empty forever
        // (the SensorKind lesson), so it is refused with the legal values named.
        let message = try XCTUnwrap(
            CalendarAccessPlan.decode(json: #"{"entity":"contacts"}"#).failureMessage)
        XCTAssertTrue(message.contains("events"), message)
        XCTAssertTrue(message.contains("reminders"), message)
        XCTAssertNotNil(CalendarAccessPlan.decode(json: "{}").failureMessage)
        XCTAssertNotNil(CalendarAccessPlan.decode(json: "not json").failureMessage)
    }

    func testEventsWindowMustBeOrderedAndFinite() throws {
        let plan = try CalendarEventsPlan.decode(
            json: #"{"startMs":1000,"endMs":2000,"limit":5}"#
        ).get()
        XCTAssertEqual(plan.limit, 5)
        XCTAssertEqual(plan.start, Date(timeIntervalSince1970: 1))
        XCTAssertEqual(plan.end, Date(timeIntervalSince1970: 2))
        // Inverted/empty windows REJECT rather than resolving `[]`: an empty
        // list a caller cannot tell from "nothing scheduled" is the one answer
        // this API must not fake.
        XCTAssertNotNil(
            CalendarEventsPlan.decode(json: #"{"startMs":2000,"endMs":1000}"#)
                .failureMessage)
        XCTAssertNotNil(
            CalendarEventsPlan.decode(json: #"{"startMs":1000,"endMs":1000}"#)
                .failureMessage)
        XCTAssertNotNil(
            CalendarEventsPlan.decode(json: #"{"startMs":1000}"#).failureMessage)
        XCTAssertNotNil(
            CalendarEventsPlan.decode(json: #"{"startMs":1000,"endMs":2000,"limit":0}"#)
                .failureMessage)
    }

    func testEventLimitIsClampedToTheCeiling() throws {
        let plan = try CalendarEventsPlan.decode(
            json: #"{"startMs":1000,"endMs":2000,"limit":100000}"#
        ).get()
        XCTAssertEqual(plan.limit, CalendarLimits.maxLimit)
        // No limit means the ceiling too — the bridge applies it — so an
        // un-capped "every event this decade" cannot cross the bridge.
        XCTAssertNil(
            try CalendarEventsPlan.decode(json: #"{"startMs":1,"endMs":2}"#).get()
                .limit)
    }

    func testRemindersDefaultToABoundedWindow() throws {
        // An argument-less call is legal: invoke sends "" for it and `{}` for
        // an empty options object, and BOTH must mean the defaults rather than
        // "reject" or "every incomplete reminder ever".
        let now = Date(timeIntervalSince1970: 1_000_000)
        for json in ["", "{}"] {
            let plan = try RemindersPlan.decode(json: json, now: now).get()
            XCTAssertEqual(
                plan.dueBefore.timeIntervalSince1970,
                now.addingTimeInterval(CalendarLimits.defaultReminderWindow)
                    .timeIntervalSince1970,
                accuracy: 0.001)
            XCTAssertNil(plan.limit)
        }
        let explicit = try RemindersPlan.decode(
            json: #"{"dueBeforeMs":5000,"limit":3}"#, now: now
        ).get()
        XCTAssertEqual(explicit.dueBefore, Date(timeIntervalSince1970: 5))
        XCTAssertEqual(explicit.limit, 3)
        XCTAssertEqual(
            try RemindersPlan.decode(json: #"{"limit":100000}"#, now: now).get()
                .limit,
            CalendarLimits.maxLimit)
        XCTAssertNotNil(
            RemindersPlan.decode(json: #"{"limit":0}"#, now: now).failureMessage)
        XCTAssertNotNil(
            RemindersPlan.decode(json: "not json", now: now).failureMessage)
        // An explicit null is "I didn't pass one", not a rejection — JS omits
        // an absent option, but a caller building the object by hand may not.
        XCTAssertNil(
            RemindersPlan.decode(json: #"{"dueBeforeMs":null}"#, now: now)
                .failureMessage)
    }
}

/// `Result.failure`'s message, or nil when the decode succeeded — so a
/// rejection assertion reads as one line.
extension Result where Failure == CalendarRequestError {
    fileprivate var failureMessage: String? {
        if case .failure(let error) = self { return error.message }
        return nil
    }
}

/// The WatchConnectivity file inbox. `session(_:didReceive:)` is `#if
/// os(watchOS)` and no Linux job compiles it, so every rule that can go wrong
/// on the receive path — an untrusted sender-supplied file name, the retention
/// bound, and the containment check `deleteReceivedFile` rests on — is decided
/// in `FileInbox` and proven here, against a real temporary directory.
final class FileInboxTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("inbox-\(UUID().uuidString)")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func inbox() -> FileInbox { FileInbox(root: root) }

    private func makeFile(_ name: String, bytes: String = "x") throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("src-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data(bytes.utf8).write(to: url)
        return url
    }

    func testSanitizeRefusesTraversalAndSeparators() {
        // The name comes from the SENDING app — an iPhone app this watch app
        // may not own — and goes straight into a filesystem path.
        XCTAssertEqual(FileInbox.sanitize("../../etc/passwd"), "....etcpasswd")
        XCTAssertEqual(FileInbox.sanitize(".."), "file")
        XCTAssertEqual(FileInbox.sanitize("."), "file")
        XCTAssertEqual(FileInbox.sanitize(""), "file")
        XCTAssertEqual(FileInbox.sanitize("   "), "file")
        XCTAssertEqual(FileInbox.sanitize("a/b:c\\d"), "abcd")
        XCTAssertFalse(FileInbox.sanitize("a\u{0}b").contains("\u{0}"))
        XCTAssertEqual(
            FileInbox.sanitize(String(repeating: "n", count: 500)).count,
            FileInbox.maxNameLength)
        XCTAssertEqual(FileInbox.sanitize("run 2026.gpx"), "run 2026.gpx")
    }

    func testAdoptMovesTheFileAndNamesItUniquely() throws {
        let box = inbox()
        let source = try makeFile("export.json", bytes: "hello")
        let landed = try box.adopt(
            source, receivedAtMs: 1_768_483_200_000, sequence: 1,
            name: "export.json")
        // Moved, not copied: the system deletes the source directory's file
        // right after the delegate returns, so a copy would be a race.
        XCTAssertFalse(FileManager.default.fileExists(atPath: source.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: landed.path))
        XCTAssertEqual(
            try Data(contentsOf: landed), Data("hello".utf8))
        XCTAssertEqual(
            landed.lastPathComponent, "1768483200000-1-export.json")
        // The sequence resets with the process, so the TIMESTAMP is what keeps
        // a later launch from overwriting a file the app still holds.
        let second = try box.adopt(
            try makeFile("export.json", bytes: "later"),
            receivedAtMs: 1_768_483_300_000, sequence: 1, name: "export.json")
        XCTAssertNotEqual(second, landed)
        XCTAssertEqual(try Data(contentsOf: landed), Data("hello".utf8))
    }

    func testAdoptRefusesToLoseTheNewFileOnAnExactCollision() throws {
        // Only reachable on an identical ms + sequence. Letting `moveItem`
        // throw would drop the INCOMING file (the system deletes the source
        // regardless) to preserve a stale one with the same name.
        let box = inbox()
        _ = try box.adopt(
            try makeFile("a.txt", bytes: "old"), receivedAtMs: 1, sequence: 1,
            name: "a.txt")
        let landed = try box.adopt(
            try makeFile("a.txt", bytes: "new"), receivedAtMs: 1, sequence: 1,
            name: "a.txt")
        XCTAssertEqual(try Data(contentsOf: landed), Data("new".utf8))
    }

    func testAdoptStampsReceiptTimeSoRetentionCannotEatANewFile() throws {
        // Retention is keyed on the modification date, and `moveItem` is a
        // rename that INHERITS the source's. The source is a temp file the WC
        // daemon wrote and Apple promises nothing about its attributes, so an
        // inherited date can be older than `maxAge` — which would make the
        // prune on the file's own receive path delete it, and
        // `session(_:didReceive:)` would then report size 0 and a dead path
        // with neither failure event firing. Receipt time is the honest key
        // and `adopt` already has it.
        let box = inbox()
        let source = try makeFile("export.json", bytes: "hello")
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(-30 * 24 * 60 * 60)],
            ofItemAtPath: source.path)
        let receivedAtMs = Int(Date().timeIntervalSince1970 * 1000)
        let landed = try box.adopt(
            source, receivedAtMs: receivedAtMs, sequence: 1, name: "export.json")
        let modified = try XCTUnwrap(
            try landed.resourceValues(forKeys: [.contentModificationDateKey])
                .contentModificationDate)
        XCTAssertEqual(
            modified.timeIntervalSince1970, Double(receivedAtMs) / 1000,
            accuracy: 1)
        // The whole point: the receive path's own prune must not eat it.
        XCTAssertTrue(box.prune().isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: landed.path))
    }

    func testRetentionDropsTheOldestPastTheCountAndAnythingStale() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let entries = (0..<5).map { index in
            FileInbox.Entry(
                url: URL(fileURLWithPath: "/inbox/\(index)"),
                modified: now.addingTimeInterval(Double(-index)))
        }
        // Count rule: newest 3 survive, the two oldest go.
        XCTAssertEqual(
            FileInbox.victims(entries, now: now, maxFiles: 3, maxAge: 10_000)
                .map(\.lastPathComponent),
            ["3", "4"])
        // Age rule bites independently of the count.
        let stale = [
            FileInbox.Entry(url: URL(fileURLWithPath: "/inbox/fresh"), modified: now),
            FileInbox.Entry(
                url: URL(fileURLWithPath: "/inbox/stale"),
                modified: now.addingTimeInterval(-100)),
        ]
        XCTAssertEqual(
            FileInbox.victims(stale, now: now, maxFiles: 32, maxAge: 50)
                .map(\.lastPathComponent),
            ["stale"])
        // Exactly at the age limit is not stale (the > in the rule).
        XCTAssertTrue(
            FileInbox.victims(stale, now: now, maxFiles: 32, maxAge: 100).isEmpty)
    }

    func testAnUnreadableModificationDateKeepsTheFileInsteadOfDeletingIt() throws {
        // Retention is the only code in this package that destroys received
        // user data, it runs on the RECEIVE path, and nothing reports what it
        // removed. So the unknown case has to fail CLOSED. The fallback used to
        // be `.distantPast`, which is "older than everything" — i.e. an
        // attribute the app could not read decided to delete the file.
        XCTAssertEqual(FileInbox.retentionDate(nil), .distantFuture)
        // A readable date is passed through untouched — the fail-closed branch
        // must not become the rule.
        let real = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(FileInbox.retentionDate(real), real)

        let unknown = FileInbox.Entry(
            url: URL(fileURLWithPath: "/inbox/unreadable"),
            modified: FileInbox.retentionDate(nil))
        let old = FileInbox.Entry(
            url: URL(fileURLWithPath: "/inbox/old"),
            modified: real.addingTimeInterval(-FileInbox.maxAge - 60))
        // The age rule cannot reach it, however long the inbox has been alive…
        XCTAssertEqual(
            FileInbox.victims([unknown, old], now: real, maxAge: FileInbox.maxAge)
                .map(\.lastPathComponent),
            ["old"])
        // …and it is not exempt from the COUNT bound, which is what keeps the
        // inbox bounded rather than trading one silent failure for growth.
        XCTAssertEqual(
            FileInbox.victims(
                [unknown, old], now: real, maxFiles: 1, maxAge: FileInbox.maxAge
            ).map(\.lastPathComponent),
            ["old"])
        // On disk: a file whose date IS readable and IS stale still goes, so
        // this did not disable age pruning.
        let box = inbox()
        let landed = try box.adopt(
            try makeFile("stale.txt"), receivedAtMs: 1, sequence: 1,
            name: "stale.txt")
        let now = Date(timeIntervalSince1970: 2_000_000)
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-FileInbox.maxAge - 60)],
            ofItemAtPath: landed.path)
        XCTAssertEqual(box.prune(now: now), [landed])
    }

    func testRetentionNeverDropsAFileWhoseEventIsStillInFlight() {
        // `session(_:didReceive:)` adopts on WatchConnectivity's background
        // thread but only SCHEDULES the `watchConnectivity.file` event onto
        // main, so a burst can outrun main by more than `maxFiles` and prune a
        // path JS was never handed. That loss is silent in both directions —
        // no diagnostic fires, and `resolve` still accepts the dead path, so
        // `deleteReceivedFile` on it returns success. `protected` is the
        // coupling that stops it.
        let now = Date(timeIntervalSince1970: 1_000_000)
        let entries = (0..<5).map { index in
            FileInbox.Entry(
                url: URL(fileURLWithPath: "/inbox/\(index)"),
                modified: now.addingTimeInterval(Double(-index)))
        }
        // Both rules must yield to it: "4" is past the count bound AND stale.
        XCTAssertEqual(
            FileInbox.victims(
                entries, now: now, maxFiles: 3, maxAge: 2,
                protected: [URL(fileURLWithPath: "/inbox/4")]
            ).map(\.lastPathComponent),
            ["3"])
        // Protecting everything drops nothing, however old.
        XCTAssertTrue(
            FileInbox.victims(
                entries, now: now, maxFiles: 1, maxAge: 0,
                protected: Set(entries.map(\.url))
            ).isEmpty)
        // An empty set is byte-identical to the plain rule: protected entries
        // keep their PLACE in the newest-first ordering rather than being
        // lifted out of it, so nothing shifts when the set is empty.
        XCTAssertEqual(
            FileInbox.victims(entries, now: now, maxFiles: 3, maxAge: 2, protected: []),
            FileInbox.victims(entries, now: now, maxFiles: 3, maxAge: 2))
    }

    func testPruneProtectsAnUndeliveredFileOnDisk() throws {
        let box = inbox()
        var landed: [URL] = []
        for index in 0..<3 {
            landed.append(
                try box.adopt(
                    try makeFile("f\(index).txt"), receivedAtMs: 1000 + index,
                    sequence: index, name: "f\(index).txt"))
        }
        let now = Date(timeIntervalSince1970: 2_000_000)
        for url in landed {
            try FileManager.default.setAttributes(
                [.modificationDate: now.addingTimeInterval(-FileInbox.maxAge - 60)],
                ofItemAtPath: url.path)
        }
        // Every file is stale, but the one still in flight survives on disk.
        let removed = box.prune(now: now, protecting: [landed[0]])
        XCTAssertEqual(Set(removed), Set(landed.dropFirst()))
        XCTAssertTrue(FileManager.default.fileExists(atPath: landed[0].path))
        // Once its event has run and the protection is dropped, the ordinary
        // rule reclaims it — the bound is delayed, not abandoned.
        XCTAssertEqual(box.prune(now: now), [landed[0]])
        XCTAssertFalse(FileManager.default.fileExists(atPath: landed[0].path))
    }

    func testPruneDeletesOnDiskAndSurvivesAMissingInbox() throws {
        let box = inbox()
        var landed: [URL] = []
        for index in 0..<4 {
            landed.append(
                try box.adopt(
                    try makeFile("f\(index).txt"), receivedAtMs: 1000 + index,
                    sequence: index, name: "f\(index).txt"))
        }
        // Age is what four files trip (the count bound is 32), so pin the
        // modification dates rather than depending on the filesystem clock:
        // the two oldest sit just past `maxAge`, the two newest just inside.
        let now = Date(timeIntervalSince1970: 2_000_000)
        for (index, url) in landed.enumerated() {
            let age = index < 2 ? FileInbox.maxAge + 60 : FileInbox.maxAge - 60
            try FileManager.default.setAttributes(
                [.modificationDate: now.addingTimeInterval(-age)],
                ofItemAtPath: url.path)
        }
        let removed = box.prune(now: now)
        XCTAssertEqual(Set(removed), Set(landed.prefix(2)))
        XCTAssertFalse(FileManager.default.fileExists(atPath: landed[0].path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: landed[3].path))
        // Housekeeping must never fail a delivery: an inbox that doesn't exist
        // prunes nothing instead of throwing.
        XCTAssertTrue(
            FileInbox(root: root.appendingPathComponent("nope")).prune().isEmpty)
    }

    func testReadPlanNeedsAPathAndDefaultsTheRange() {
        switch ReceivedFileReadPlan.decode(json: #"{"path":"/inbox/a","offset":9}"#) {
        case .success(let plan):
            XCTAssertEqual(plan.path, "/inbox/a")
            XCTAssertEqual(plan.offset, 9)
            // Omitted length means "as much as one chunk may carry", NOT zero.
            XCTAssertNil(plan.length)
        case .failure(let error): XCTFail("rejected a valid plan: \(error)")
        }
        for json in ["{}", #"{"path":""}"#, "[]", "not json", #"{"path":7}"#] {
            switch ReceivedFileReadPlan.decode(json: json) {
            case .success: XCTFail("accepted \(json)")
            case .failure(let error):
                XCTAssertEqual(error.code, .invalidRequest)
            }
        }
        // `offset`/`length` are `number` on the wire — a JS double — so
        // `{ offset: file.size / 2 }` is type-legal and arrives fractional. The
        // refusal has to name the field it is about: reporting it as a missing
        // `path` sends the caller to debug an argument they did pass.
        for (json, field) in [
            (#"{"path":"/inbox/a","offset":1.5}"#, "offset"),
            (#"{"path":"/inbox/a","length":2.5}"#, "length"),
        ] {
            switch ReceivedFileReadPlan.decode(json: json) {
            case .success: XCTFail("accepted \(json)")
            case .failure(let error):
                XCTAssertEqual(error.code, .invalidRequest)
                XCTAssertTrue(
                    error.message.contains("`\(field)`"),
                    "\(json) blamed the wrong field: \(error.message)")
            }
        }
        // A whole number that a JSON writer spelled with a fraction part is
        // still a byte count, and a NEGATIVE one belongs to `readWindow`'s
        // rule, not this one — decode must not take that refusal over.
        XCTAssertEqual(
            try ReceivedFileReadPlan.decode(
                json: #"{"path":"/inbox/a","offset":2.0}"#
            ).get().offset, 2)
        XCTAssertEqual(
            try ReceivedFileReadPlan.decode(
                json: #"{"path":"/inbox/a","offset":-1}"#
            ).get().offset, -1)
    }

    func testReadWindowRefusesEveryRangeItCannotHonourExactly() {
        let cap = 300
        // The happy default: everything left, up to the ceiling.
        XCTAssertEqual(
            try XCTUnwrap(
                FileInbox.readWindow(
                    offset: 0, length: nil, totalBytes: 100, maxBytes: cap
                ).get()),
            ReceivedFileReadWindow(offset: 0, length: 100))
        // Offset AT the end is legal and yields an empty, EOF chunk — that is
        // how a loop terminates on a zero-byte file.
        XCTAssertEqual(
            try XCTUnwrap(
                FileInbox.readWindow(
                    offset: 100, length: nil, totalBytes: 100, maxBytes: cap
                ).get()
            ).length, 0)
        // A chunk that does NOT end the file is trimmed to a multiple of 3, so
        // the base64 of successive chunks concatenates rather than padding
        // mid-file. 100 bytes left, ceiling 50 -> 48.
        XCTAssertEqual(
            try XCTUnwrap(
                FileInbox.readWindow(
                    offset: 0, length: nil, totalBytes: 100, maxBytes: 50
                ).get()
            ).length, 48)
        // …and the LAST chunk is NOT trimmed, or the tail would be unreachable:
        // 49 bytes left, under the ceiling, kept whole though 49 % 3 != 0.
        XCTAssertEqual(
            try XCTUnwrap(
                FileInbox.readWindow(
                    offset: 51, length: nil, totalBytes: 100, maxBytes: 50
                ).get()
            ).length, 49)

        // Every refusal, because silently returning a different range than the
        // one asked for is the failure mode this op exists to remove.
        let refusals: [(Int, Int?, String)] = [
            (-1, nil, "negative offset"),
            (101, nil, "offset past the end"),
            (0, 0, "zero length"),
            (0, -5, "negative length"),
            (0, cap + 1, "length over the ceiling"),
            (0, 2, "a mid-file chunk too short to concatenate"),
        ]
        for (offset, length, reason) in refusals {
            switch FileInbox.readWindow(
                offset: offset, length: length, totalBytes: 100, maxBytes: cap)
            {
            case .success: XCTFail("accepted \(reason)")
            case .failure(let error):
                XCTAssertEqual(error.code, .invalidRequest, reason)
                XCTAssertFalse(error.message.isEmpty, reason)
            }
        }
        // The same 2-byte length IS legal when it reaches the end — the trim
        // rule applies to non-final chunks only.
        XCTAssertEqual(
            try XCTUnwrap(
                FileInbox.readWindow(
                    offset: 98, length: 2, totalBytes: 100, maxBytes: cap
                ).get()
            ).length, 2)
    }

    func testReadReturnsTheFileInConcatenatingChunks() throws {
        let box = inbox()
        let bytes = Data((0..<250).map { UInt8($0 % 251) })
        let source = try makeFile("clip.bin")
        try bytes.write(to: source)
        let landed = try box.adopt(
            source, receivedAtMs: 1, sequence: 1, name: "clip.bin")

        var assembled = ""
        var offset = 0
        var chunks = 0
        while true {
            let chunk = try XCTUnwrap(
                box.read(
                    ReceivedFileReadPlan(
                        path: landed.absoluteString, offset: offset, length: 100)
                ).get())
            XCTAssertEqual(chunk.totalBytes, 250)
            XCTAssertEqual(chunk.offset, offset)
            assembled += chunk.base64
            chunks += 1
            if chunk.eof { break }
            // `bytes` is what advances the cursor — never the requested length.
            offset += chunk.bytes
            XCTAssertLessThan(chunks, 10, "loop did not terminate")
        }
        // THE property the multiple-of-3 trim buys: the CONCATENATED base64 of
        // the chunks decodes to the file. Without the trim this is silently the
        // wrong bytes, because base64 pads each partial 3-byte group.
        XCTAssertEqual(Data(base64Encoded: assembled), bytes)
        XCTAssertGreaterThan(chunks, 1, "the range was never actually chunked")
        // One unbounded read gets the whole file and reports eof immediately.
        let whole = try XCTUnwrap(
            box.read(ReceivedFileReadPlan(path: landed.path)).get())
        XCTAssertTrue(whole.eof)
        XCTAssertEqual(whole.bytes, 250)
        XCTAssertEqual(Data(base64Encoded: whole.base64), bytes)
    }

    func testReadRefusesAPathOutsideTheInboxAndOneRetentionTookBack() throws {
        let box = inbox()
        let landed = try box.adopt(
            try makeFile("ok.txt", bytes: "hello"), receivedAtMs: 1, sequence: 1,
            name: "ok.txt")
        // Containment is `resolve`'s, so a read cannot reach further than a
        // delete can: the same traversal that must not be deletable must not be
        // readable either.
        for path in [
            "/etc/passwd", root.appendingPathComponent("../../etc/passwd").path,
            "relative/file.txt", root.path,
        ] {
            switch box.read(ReceivedFileReadPlan(path: path)) {
            case .success: XCTFail("read \(path) from outside the inbox")
            case .failure(let error):
                XCTAssertEqual(error.code, .invalidRequest)
                XCTAssertTrue(error.message.contains("not a file this app received"))
            }
        }
        // A path that WAS in the inbox and is gone gets the other answer, so an
        // app can tell "you asked for something that was never yours" from
        // "retention reclaimed it".
        try FileManager.default.removeItem(at: landed)
        switch box.read(ReceivedFileReadPlan(path: landed.absoluteString)) {
        case .success: XCTFail("read a file that is gone")
        case .failure(let error):
            XCTAssertEqual(error.code, .invalidRequest)
            XCTAssertTrue(error.message.contains("no longer in the inbox"))
        }
    }

    func testTheChunkCeilingIsTheFetchBodyCeiling() {
        // One constraint (the QuickJS heap), one number. A second, drifting
        // number would let the same file be readable through one bridge and not
        // the other — and this is a HARD reject, so it belongs with the hard
        // ceilings and not in BudgetPolicy, whose caps warn and proceed.
        XCTAssertEqual(FileInbox.maxReadBytes, FetchResponse.defaultMaxBodyBytes)
    }

    func testResolveRefusesEverythingOutsideTheInbox() throws {
        let box = inbox()
        let landed = try box.adopt(
            try makeFile("ok.txt"), receivedAtMs: 1, sequence: 1, name: "ok.txt")
        // The two forms JS can hand back: the `file://` URL the event carried,
        // and a bare absolute path.
        XCTAssertEqual(box.resolve(path: landed.absoluteString)?.path, landed.path)
        XCTAssertEqual(box.resolve(path: landed.path)?.path, landed.path)
        // THE check this whole method exists for: `..` is standardized away
        // BEFORE the prefix compare, so it cannot be walked around.
        XCTAssertNil(
            box.resolve(
                path: root.appendingPathComponent("../../etc/passwd").path))
        XCTAssertNil(box.resolve(path: "/etc/passwd"))
        XCTAssertNil(box.resolve(path: "relative/file.txt"))
        XCTAssertNil(box.resolve(path: ""))
        // A prefix match on the STRING is not containment: a sibling directory
        // whose name starts with the inbox's must not resolve.
        XCTAssertNil(box.resolve(path: root.path + "-evil/file.txt"))
        // The inbox directory itself is not a file in the inbox.
        XCTAssertNil(box.resolve(path: root.path))
    }
}

// Pins the ordering/release rule PhoneConnectivity's `watchConnectivity.file`
// parking relies on (see ParkedQueue's doc comment) — PhoneConnectivity itself
// is watchOS-only and can't run under `swift test`, so this is the queue's
// contract in isolation.
final class ParkedQueueTests: XCTestCase {
    func testDrainReturnsParkedValuesInArrivalOrderAndEmpties() {
        let queue = ParkedQueue<Int>()
        queue.park(1)
        queue.park(2)
        queue.park(3)
        XCTAssertEqual(queue.drain(), [1, 2, 3])
        XCTAssertTrue(queue.isEmpty)
        XCTAssertEqual(queue.drain(), [], "a second drain must not replay")
    }

    func testDrainOnAnEmptyQueueIsANoOp() {
        let queue = ParkedQueue<String>()
        XCTAssertTrue(queue.isEmpty)
        XCTAssertEqual(queue.drain(), [])
    }

    // The crux of the data-loss fix: whatever RELEASES a parked value (here,
    // FileInbox's prune protection stand-in) must fire only on drain, never
    // merely because the value was parked — a release on `park` would leave
    // the file unprotected for the whole time it sits waiting for `jsReady`,
    // exactly reopening the window retention could prune it through.
    func testParkingDoesNotReleaseUntilDrained() {
        let queue = ParkedQueue<() -> Void>()
        var released = false
        queue.park { released = true }
        XCTAssertFalse(released, "park() must not run the release action")
        for release in queue.drain() { release() }
        XCTAssertTrue(released)
    }
}

// Pins the mutual-exclusion guarantee WorkoutPlanBridge.schedule needs to
// close its actor-reentrancy race (ReactWatchHost, watchOS-only, untestable
// directly with real WorkoutKit) — see SerialTaskQueue's doc comment.
final class SerialTaskQueueTests: XCTestCase {
    private actor Tracker {
        private(set) var active = 0
        private(set) var maxActive = 0

        func enter() {
            active += 1
            maxActive = max(maxActive, active)
        }
        func exit() { active -= 1 }
    }

    // The crux: five operations enqueued CONCURRENTLY must never overlap.
    // Without SerialTaskQueue's chaining (e.g. `run` just `await`ing
    // `operation()` directly), five tasks each parked on a real suspension
    // point run concurrently and `maxActive` climbs above 1 — exactly the
    // window that let two identical `WorkoutPlanBridge.schedule` calls both
    // pass their "not already scheduled" read before either wrote.
    func testOperationsNeverOverlap() async {
        let queue = SerialTaskQueue()
        let tracker = Tracker()
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<5 {
                group.addTask {
                    await queue.run {
                        await tracker.enter()
                        // A real suspension point INSIDE the operation, like
                        // WorkoutPlanBridge's `await scheduler.schedule(...)`
                        // — the exact place actor reentrancy could interleave
                        // a second call if `run` didn't serialize past it.
                        try? await Task.sleep(nanoseconds: 2_000_000)
                        await tracker.exit()
                    }
                }
            }
        }
        let maxActive = await tracker.maxActive
        XCTAssertEqual(maxActive, 1, "two operations ran concurrently")
    }

    func testReturnsEachOperationsOwnResult() async {
        let queue = SerialTaskQueue()
        let a = await queue.run { 1 }
        let b = await queue.run { "two" }
        XCTAssertEqual(a, 1)
        XCTAssertEqual(b, "two")
    }
}
