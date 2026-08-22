import Foundation
import ReactWatchSupport
import XCTest

/// The Linux-testable half of on-device AI: the generate request decode, the
/// generateObject schema subset's validation, and the error vocabulary. The
/// FoundationModels mapping itself compiles only against the watchOS 27 SDK —
/// what these tests pin is the WIRE the SDK-gated code consumes, plus the
/// cross-language fixtures the JS suite writes from real `host.generate`
/// traffic (the invoke-contract idiom, applied to the one direct method that
/// carries a structured request).
final class AIPlanTests: XCTestCase {
    // MARK: - GeneratePlan decode

    func testDecodesFullTextRequest() throws {
        let plan = try XCTUnwrap(
            GeneratePlan(
                json: #"""
                    {"prompt":"Summarize my day","instructions":"Be terse.",
                     "temperature":0.7,"maxTokens":128,
                     "stream":true,"partialIntervalMs":100}
                    """#))
        XCTAssertEqual(plan.prompt, "Summarize my day")
        XCTAssertEqual(plan.instructions, "Be terse.")
        XCTAssertEqual(plan.temperature, 0.7)
        XCTAssertEqual(plan.maxTokens, 128)
        XCTAssertTrue(plan.wantsStream)
        XCTAssertEqual(plan.partialIntervalMs, 100)
        XCTAssertNil(plan.schema)
        XCTAssertNil(plan.schemaProblem())
    }

    func testMinimalRequestDefaults() throws {
        let plan = try XCTUnwrap(GeneratePlan(json: #"{"prompt":"hi"}"#))
        XCTAssertEqual(plan.prompt, "hi")
        XCTAssertNil(plan.instructions)
        XCTAssertFalse(plan.wantsStream)
        XCTAssertNil(plan.schemaProblem())
    }

    func testRejectsBadInput() {
        XCTAssertNil(GeneratePlan(json: "not json"))
        XCTAssertNil(GeneratePlan(json: #"{"maxTokens":4}"#))  // no prompt
    }

    func testSchemaSuppressesStreaming() throws {
        // generateObject settles once; a stray stream flag must not turn on
        // the partial channel for a structured request.
        let plan = try XCTUnwrap(
            GeneratePlan(
                json: #"""
                    {"prompt":"p","stream":true,
                     "schema":{"type":"object","properties":[]}}
                    """#))
        XCTAssertFalse(plan.wantsStream)
    }

    // MARK: - Schema decode + validation

    private func schema(_ json: String) throws -> AISchemaNode {
        try XCTUnwrap(
            GeneratePlan(json: #"{"prompt":"p","schema":\#(json)}"#)?.schema)
    }

    func testDecodesNestedSchemaInOrder() throws {
        let node = try schema(
            #"""
            {"type":"object","description":"a person","properties":[
              {"name":"name","schema":{"type":"string"}},
              {"name":"age","optional":true,
               "schema":{"type":"integer","description":"years"}},
              {"name":"tags","schema":{"type":"array","minItems":1,
               "maxItems":3,"items":{"type":"string","enum":["a","b"]}}}
            ]}
            """#)
        XCTAssertNil(node.rootProblem())
        let properties = try XCTUnwrap(node.properties)
        // Order is the point of the array wire — guided generation follows it.
        XCTAssertEqual(properties.map(\.name), ["name", "age", "tags"])
        XCTAssertEqual(properties[1].optional, true)
        XCTAssertNil(properties[0].optional)  // absent = required
        let tags = try XCTUnwrap(properties[2].schema.items)
        XCTAssertEqual(tags.choices, ["a", "b"])
        XCTAssertEqual(properties[2].schema.minItems, 1)
        XCTAssertEqual(properties[2].schema.maxItems, 3)
    }

    func testRootMustBeAnObject() throws {
        let node = try schema(#"{"type":"string"}"#)
        XCTAssertEqual(
            node.rootProblem(),
            "schema root must be type \"object\", got \"string\"")
    }

    func testValidationRejectsEachRuleBreach() throws {
        // Every rule the closed subset enforces, one breach each. The
        // messages are part of the contract loosely (a path + a reason);
        // asserting containment keeps rewording cheap.
        let cases: [(json: String, fragment: String)] = [
            (
                #"{"type":"object","properties":[{"name":"x","schema":{"type":"date"}}]}"#,
                "unsupported type \"date\""
            ),
            (
                #"{"type":"object","properties":[{"name":"x","schema":{"type":"integer","enum":["a"]}}]}"#,
                "enum is only supported on type \"string\""
            ),
            (
                #"{"type":"object","properties":[{"name":"x","schema":{"type":"string","enum":[]}}]}"#,
                "enum must not be empty"
            ),
            (
                #"{"type":"object"}"#,
                "object requires properties"
            ),
            (
                #"{"type":"object","properties":[{"name":"","schema":{"type":"string"}}]}"#,
                "property name must not be empty"
            ),
            (
                #"{"type":"object","properties":[{"name":"x","schema":{"type":"string"}},{"name":"x","schema":{"type":"boolean"}}]}"#,
                "duplicate property \"x\""
            ),
            (
                #"{"type":"object","properties":[{"name":"x","schema":{"type":"array"}}]}"#,
                "array requires items"
            ),
            (
                #"{"type":"object","properties":[{"name":"x","schema":{"type":"array","minItems":-1,"items":{"type":"string"}}}]}"#,
                "minItems must be >= 0"
            ),
            (
                #"{"type":"object","properties":[{"name":"x","schema":{"type":"array","minItems":3,"maxItems":2,"items":{"type":"string"}}}]}"#,
                "minItems > maxItems"
            ),
        ]
        for (json, fragment) in cases {
            let problem = try schema(json).rootProblem()
            XCTAssertNotNil(problem, "expected a problem for \(json)")
            XCTAssertTrue(
                problem?.contains(fragment) == true,
                "expected \"\(fragment)\" in \"\(problem ?? "nil")\"")
        }
    }

    func testProblemPathNamesTheFailingNode() throws {
        let node = try schema(
            #"""
            {"type":"object","properties":[
              {"name":"pets","schema":{"type":"array","items":
                {"type":"object","properties":[
                  {"name":"kind","schema":{"type":"string","enum":[]}}]}}}]}
            """#)
        XCTAssertEqual(
            node.rootProblem(), "schema.pets[].kind: enum must not be empty")
    }

    // MARK: - Error vocabulary

    func testGenerationErrorCaseMapping() {
        // The classification table the SDK-gated host switch feeds; case
        // names are FoundationModels `GenerationError` cases (docs JSON,
        // 2026-08-22 — every one watchOS 27.0 beta via the framework page).
        let expected: [(name: String, code: AIErrorCode)] = [
            ("assetsUnavailable", .unavailable),
            ("guardrailViolation", .guardrailViolation),
            ("exceededContextWindowSize", .contextWindowExceeded),
            ("unsupportedLanguageOrLocale", .unsupportedLanguage),
            ("decodingFailure", .decodingFailure),
            ("rateLimited", .rateLimited),
            ("concurrentRequests", .concurrentRequests),
            ("refusal", .refusal),
            ("unsupportedGuide", .invalidSchema),
            // An FM case this binary predates degrades to the honest
            // "we don't know", never to a lying specific code.
            ("someFutureCase", .internalError),
        ]
        for (name, code) in expected {
            XCTAssertEqual(
                AIErrorCode.forGenerationError(caseName: name), code,
                "case \(name)")
        }
    }

    func testErrorJSONEscapesHostileMessages() throws {
        // The InvokeErrorJSON regression, pinned on this channel too: quotes,
        // backslashes and newlines in a model-supplied message must survive.
        let json = AIErrorJSON.make(
            code: .refusal, message: "he said \"no\" \\ twice\nline two")
        let decoded = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(json.utf8))
                as? [String: String])
        XCTAssertEqual(decoded["code"], "REFUSAL")
        XCTAssertEqual(decoded["message"], "he said \"no\" \\ twice\nline two")
    }

    // MARK: - Cross-language fixtures (written by js/test/ai.test.ts)

    private func fixture(_ name: String) throws -> String {
        let url = try XCTUnwrap(
            Bundle.module.url(
                forResource: name, withExtension: "json",
                subdirectory: "Fixtures"),
            "missing fixture \(name).json — run the JS suite to regenerate")
        return try String(contentsOf: url, encoding: .utf8)
    }

    func testRealGenerateTextRequestDecodes() throws {
        let plan = try XCTUnwrap(
            GeneratePlan(json: try fixture("generate-text-request")),
            "the JS wrapper's real streaming request no longer decodes")
        XCTAssertTrue(plan.wantsStream)
        XCTAssertNotNil(plan.maxTokens)
        XCTAssertNotNil(plan.instructions)
        XCTAssertNotNil(plan.partialIntervalMs)
    }

    func testRealGenerateObjectRequestDecodes() throws {
        let plan = try XCTUnwrap(
            GeneratePlan(json: try fixture("generate-object-request")),
            "the JS wrapper's real structured request no longer decodes")
        XCTAssertNil(plan.schemaProblem())
        let root = try XCTUnwrap(plan.schema)
        XCTAssertEqual(root.type, "object")
        // The JS fixture nests every subset construct once (object, array,
        // enum string, integer, boolean, optional) so a decode regression on
        // any of them fails HERE, not on a watch.
        XCTAssertFalse(root.properties?.isEmpty ?? true)
    }
}
