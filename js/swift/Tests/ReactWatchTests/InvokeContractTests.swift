import Foundation
import ReactWatchCore
import ReactWatchSupport
import XCTest

/// ARCH-11: the SD-1 invoke channel's shape contract, in actual Swift, on Linux.
///
/// The REQUEST fixtures are produced by `js/test/invoke-contract.test.ts` from
/// the REAL wrappers (the payload `invoke()` actually serialized) — never a
/// hand-authored copy, the same discipline as `WireContractTests`. The RESPONSE
/// fixtures are the result each wrapper resolved from a TS-literal mock reply,
/// bound to the declared shape by the `Exact<>` compile-time assertion: that
/// pins the JS consumer side. The native PRODUCERS — the hand-built
/// `[String: Any]` each handler resolves with — are pinned separately by
/// `js/test/invoke-producer-keys.test.ts`, which scans those Swift functions
/// textually (they are watchOS-only, so they cannot be compiled here).
/// Here each fixture is decoded with the schema-generated strict decoder
/// (`Generated/InvokeShapes.swift`, undeclared keys reject), and the two
/// payloads that have a real shipped decoder are additionally run through it.
final class InvokeContractTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(
                forResource: name, withExtension: "json", subdirectory: "Fixtures"
            ),
            "missing fixture \(name).json — run the JS suite to regenerate"
        )
        return try Data(contentsOf: url)
    }

    private func requestFixture(_ method: String) throws -> Data {
        try fixture("invoke-\(method)-request")
    }

    /// Every request fixture for `method`: the canonical
    /// `invoke-<method>-request.json` plus any `invoke-<method>--<variant>-`
    /// one the JS suite wrote. Discovered from the bundle rather than listed
    /// here, so a variant added on the JS side is decoded without a Swift edit
    /// — a fixture nobody reads would be worse than no fixture.
    private func requestFixtures(_ method: String) throws -> [Data] {
        let base = try XCTUnwrap(
            Bundle.module.url(
                forResource: "invoke-\(method)-request", withExtension: "json",
                subdirectory: "Fixtures"
            ),
            "missing fixture invoke-\(method)-request.json"
        )
        let directory = base.deletingLastPathComponent()
        var all = [try Data(contentsOf: base)]
        let names = try FileManager.default.contentsOfDirectory(
            atPath: directory.path)
        for name in names.sorted()
        where name.hasPrefix("invoke-\(method)--") && name.hasSuffix("-request.json") {
            all.append(try Data(contentsOf: directory.appendingPathComponent(name)))
        }
        return all
    }

    /// Every declared REQUEST shape decodes the payload the JS wrapper really
    /// sends. A renamed or dropped required field (the `afterMs` class of bug)
    /// throws here instead of degrading to a default on a watch.
    func testDeclaredRequestShapesDecodeRealPayloads() throws {
        XCTAssertFalse(InvokeShapes.requestDecoders.isEmpty)
        for (method, decode) in InvokeShapes.requestDecoders {
            for data in try requestFixtures(method) {
                XCTAssertNoThrow(
                    try decode(data),
                    "\(method)'s payload no longer matches its schema request shape")
            }
        }
    }

    /// Every declared RESULT shape decodes what the wrapper resolves. The JS
    /// side additionally pins those shapes to the public TS interfaces at
    /// compile time, so this closes the loop native -> wire -> caller.
    func testDeclaredResultShapesDecodeRealResults() throws {
        XCTAssertFalse(InvokeShapes.responseDecoders.isEmpty)
        for (method, decode) in InvokeShapes.responseDecoders {
            let data = try fixture("invoke-\(method)-response")
            XCTAssertNoThrow(
                try decode(data),
                "\(method)'s result no longer matches its schema result shape")
        }
    }

    /// The three connectivity payloads are the consuming app's own JSON by
    /// contract — no schema describes them. What Swift DOES require is that
    /// they are a JSON **object**: `PhoneConnectivity` casts to
    /// `[String: Any]` and rejects INVALID_REQUEST otherwise, so a wrapper
    /// that started sending an array or a scalar would be a silent break.
    func testOpaqueRequestsAreJSONObjects() throws {
        XCTAssertEqual(InvokeShapes.opaqueRequests.count, 3)
        for method in InvokeShapes.opaqueRequests {
            let data = try requestFixture(method)
            let object = try? JSONDecoder().decode(
                [String: JSONValue].self, from: data)
            XCTAssertNotNil(object, "\(method) no longer sends a JSON object")
        }
    }

    /// The one invoke payload with a shipped, Linux-reachable decoder:
    /// `NotificationPlan` requires id/title/body/sound and computes the trigger.
    /// Decoding the REAL payload with the REAL decoder is what proves the
    /// schema shape and the handler agree — the generated struct alone only
    /// proves the schema and the JS wrapper agree.
    func testScheduleNotificationDecodesWithTheShippedDecoder() throws {
        let json = try String(
            data: requestFixture("scheduleNotification"), encoding: .utf8)
        let plan = try XCTUnwrap(
            NotificationPlan(json: try XCTUnwrap(json), now: Date(timeIntervalSince1970: 0)),
            "the real scheduleNotification payload no longer decodes as a NotificationPlan"
        )
        XCTAssertEqual(plan.id, "fixture-notification")
        XCTAssertEqual(plan.sound, true)
        // afterMs 60_000 -> 60s, not the 1s floor a dropped field would give.
        XCTAssertEqual(plan.triggerSeconds, 60)
        XCTAssertFalse(plan.scheduledInPast)
    }

    /// And the rings read, whose shipped decoder carries the most rules of any
    /// in the family: the strict `"YYYY-MM-DD"` parse, the INCLUSIVE range, and
    /// the day ceiling. The generated `ActivitySummariesRequest` proves the
    /// schema and the JS wrapper agree; only running the real payload through
    /// `ActivitySummariesPlan` proves the schema and the HANDLER do — that the
    /// wrapper's date strings are the spelling the plan accepts, and that its
    /// week is counted as seven days rather than six.
    func testQueryActivitySummariesDecodesWithTheShippedDecoder() throws {
        let json = try String(
            data: requestFixture("queryActivitySummaries"), encoding: .utf8)
        let plan = try ActivitySummariesPlan.decode(
            json: try XCTUnwrap(json)
        ).get()
        XCTAssertEqual(plan.start.iso, "2026-01-14")
        XCTAssertEqual(plan.end.iso, "2026-01-20")
        // Seven dates asked for, seven days counted — a half-open reading would
        // say six, and would query one day short of what the caller asked for.
        XCTAssertEqual(plan.dayCount, 7)
    }

    /// The other one: `saveUpdate`'s payload is decoded inside
    /// `OTASequencer.stage` by `UpdatePlan`, off-main.
    func testSaveUpdateDecodesWithTheShippedDecoder() throws {
        let json = try String(data: requestFixture("saveUpdate"), encoding: .utf8)
        let plan = UpdatePlan(payload: try XCTUnwrap(json))
        XCTAssertEqual(plan.js, "globalThis.__bundle = 1;")
        XCTAssertEqual(plan.version, 7)
        XCTAssertEqual(plan.keyId, "k1")
        XCTAssertEqual(plan.expiresAt, 1_800_000_000)
        XCTAssertEqual(plan.requiredFeatures, ["storage", "widgets"])
        XCTAssertEqual(plan.minBridgeProtocol, 1)
        XCTAssertNotNil(plan.signature, "the base64 signature no longer decodes")
    }
}
