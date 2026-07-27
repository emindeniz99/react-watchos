import Foundation
import ReactWatchCore
import ReactWatchSupport
import XCTest

/// ARCH-11: the SD-1 invoke channel's shape contract, in actual Swift, on Linux.
///
/// The fixtures are produced by `js/test/invoke-contract.test.ts` from the REAL
/// wrappers (the payload `invoke()` actually serialized, and the result the
/// wrapper actually resolved) — never a hand-authored copy, the same discipline
/// as `WireContractTests`. Here each one is decoded with the schema-generated
/// struct (`Generated/InvokeShapes.swift`), and the two payloads that have a
/// real shipped decoder are additionally run through it.
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

    /// Every declared REQUEST shape decodes the payload the JS wrapper really
    /// sends. A renamed or dropped required field (the `afterMs` class of bug)
    /// throws here instead of degrading to a default on a watch.
    func testDeclaredRequestShapesDecodeRealPayloads() throws {
        XCTAssertFalse(InvokeShapes.requestDecoders.isEmpty)
        for (method, decode) in InvokeShapes.requestDecoders {
            let data = try requestFixture(method)
            XCTAssertNoThrow(
                try decode(data),
                "\(method)'s payload no longer matches its schema request shape")
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
