import Foundation

/// The generate settle wire's closed error vocabulary — the Swift half of
/// `AIErrorCode` in js/src/ai.ts, closed as an enum for the same reason
/// `InvokeErrorCode` is: a reject site that can spell an ad-hoc string ships
/// one (twice, historically), and no JS `if (e.code === …)` ever matches it.
///
/// `ABORTED` and `TIMEOUT` are listed even though native never sends them —
/// they are minted JS-side (the abort signal, the inactivity watchdog) — so
/// the whole vocabulary is closed in one place per language and the two
/// spellings can be pinned against each other by test.
public enum AIErrorCode: String, Sendable, CaseIterable {
    /// No FoundationModels on this build/OS, Apple Intelligence off, or the
    /// model assets aren't on the watch (`GenerationError.assetsUnavailable`).
    case unavailable = "UNAVAILABLE"
    /// Apple's safety guardrails flagged prompt or response.
    case guardrailViolation = "GUARDRAIL_VIOLATION"
    /// Prompt + response no longer fit the model's context window.
    case contextWindowExceeded = "CONTEXT_WINDOW_EXCEEDED"
    /// The prompt's language/locale isn't supported by the on-device model.
    case unsupportedLanguage = "UNSUPPORTED_LANGUAGE"
    /// The model produced output that doesn't decode as the asked-for shape
    /// (native `GenerationError.decodingFailure`, or JS failing to parse a
    /// structured result) — the "malformed, not garbage" rejection.
    case decodingFailure = "DECODING_FAILURE"
    /// The system rate-limited the app's generations.
    case rateLimited = "RATE_LIMITED"
    /// A second request hit a session that only serves one at a time.
    case concurrentRequests = "CONCURRENT_REQUESTS"
    /// The model declined to answer the prompt.
    case refusal = "REFUSAL"
    /// The `generateObject` schema is outside the supported subset (or
    /// FoundationModels rejected it — `GenerationError.unsupportedGuide`).
    /// Also a tool's `parameters` schema, same subset, `tools.<name>` path.
    case invalidSchema = "INVALID_SCHEMA"
    /// A tool the model invoked failed: the JS handler threw or replied
    /// malformed (`LanguageModelSession.ToolCallError` natively — a distinct
    /// wrapper type, not a `GenerationError` case, which is why it has no row
    /// in `forGenerationError`).
    case toolFailed = "TOOL_FAILED"
    /// JS-side only: the caller's abort signal fired.
    case aborted = "ABORTED"
    /// JS-side only: the inactivity watchdog fired (no settle, no partial).
    case timeout = "TIMEOUT"
    /// A native error with no better classification.
    case internalError = "INTERNAL"

    /// Maps a FoundationModels `LanguageModelSession.GenerationError` CASE NAME
    /// to a wire code. Pure and name-keyed so this — the actual
    /// classification — is Linux-tested; the SDK-gated host switch only
    /// transcribes each FM case to its name (a step that can't silently drift:
    /// a renamed case fails the host compile on the watch SDK).
    public static func forGenerationError(caseName: String) -> AIErrorCode {
        switch caseName {
        case "assetsUnavailable": return .unavailable
        case "guardrailViolation": return .guardrailViolation
        case "exceededContextWindowSize": return .contextWindowExceeded
        case "unsupportedLanguageOrLocale": return .unsupportedLanguage
        case "decodingFailure": return .decodingFailure
        case "rateLimited": return .rateLimited
        case "concurrentRequests": return .concurrentRequests
        case "refusal": return .refusal
        case "unsupportedGuide": return .invalidSchema
        default: return .internalError
        }
    }
}

/// The one way to build a generate reject payload (`{code, message}`) — the
/// `InvokeErrorJSON` discipline applied to the generate channel: via
/// JSONSerialization so ANY message content (a model-supplied refusal string,
/// a localizedDescription with quotes/newlines) escapes correctly.
public enum AIErrorJSON {
    public static func make(code: AIErrorCode, message: String) -> String {
        (try? JSONSerialization.data(
            withJSONObject: ["code": code.rawValue, "message": message]))
            .flatMap { String(data: $0, encoding: .utf8) }
            ?? #"{"code":"INTERNAL","message":"error encoding failed"}"#
    }
}

/// One node of a `generateObject` schema as it crosses the wire — a closed
/// JSON-Schema-flavored subset (see js/src/ai.ts `AIObjectSchema` for the
/// public vocabulary and the design note for what was cut and why).
///
/// `properties` is an ORDERED ARRAY of named entries, not the JSON-Schema
/// object it is in the public JS API: property order steers guided generation
/// (DynamicGenerationSchema takes `[Property]`), and a Swift `[String: …]`
/// decode would shuffle it. js/src/ai.ts converts (`Object.entries` preserves
/// the author's insertion order) and folds `required` into per-property
/// `optional` flags — `Property.isOptional`'s polarity — on the way.
///
/// A final class, not a struct: the type is recursive (`items` nests one), and
/// all-`let` storage keeps it Sendable.
public final class AISchemaNode: Decodable, Sendable {
    public let type: String
    public let description: String?
    /// String choices (string type only) — `GenerationGuide.anyOf`.
    public let choices: [String]?
    /// Array element schema (array type only).
    public let items: AISchemaNode?
    public let minItems: Int?
    public let maxItems: Int?
    /// Object members, in the author's order (object type only).
    public let properties: [AISchemaProperty]?

    enum CodingKeys: String, CodingKey {
        // The wire spells it `enum` (the JSON Schema keyword); `enum` is a
        // Swift keyword, so the property is `choices`.
        case type, description, items, minItems, maxItems, properties
        case choices = "enum"
    }

    /// The closed `type` vocabulary. Closed on the SensorKind reasoning: an
    /// unknown type must reject, not silently generate a string.
    public static let types: Set<String> = [
        "object", "array", "string", "number", "integer", "boolean",
    ]

    /// First problem found walking this node as a schema ROOT, or nil if the
    /// whole tree is inside the supported subset. Root must be an object —
    /// every consumer pattern surveyed is object-rooted, and the object's name
    /// is the model-visible root type.
    public func rootProblem() -> String? {
        if type != "object" {
            return "schema root must be type \"object\", got \"\(type)\""
        }
        return problem(at: "schema")
    }

    /// Recursive walk; `path` names the failing node for the error message.
    func problem(at path: String) -> String? {
        guard AISchemaNode.types.contains(type) else {
            return "\(path): unsupported type \"\(type)\""
        }
        if let choices {
            if type != "string" {
                return "\(path): enum is only supported on type \"string\""
            }
            if choices.isEmpty { return "\(path): enum must not be empty" }
        }
        switch type {
        case "object":
            guard let properties else {
                return "\(path): object requires properties"
            }
            var seen = Set<String>()
            for property in properties {
                if property.name.isEmpty {
                    return "\(path): property name must not be empty"
                }
                if !seen.insert(property.name).inserted {
                    return "\(path): duplicate property \"\(property.name)\""
                }
                if let nested = property.schema.problem(
                    at: "\(path).\(property.name)")
                {
                    return nested
                }
            }
        case "array":
            guard let items else { return "\(path): array requires items" }
            if let min = minItems, min < 0 {
                return "\(path): minItems must be >= 0"
            }
            if let max = maxItems, max < 0 {
                return "\(path): maxItems must be >= 0"
            }
            if let min = minItems, let max = maxItems, min > max {
                return "\(path): minItems > maxItems"
            }
            if let nested = items.problem(at: "\(path)[]") { return nested }
        default:
            break
        }
        return nil
    }
}

/// One named object member on the wire (`{name, optional?, schema}`).
public struct AISchemaProperty: Decodable, Sendable {
    public let name: String
    /// JSON Schema's polarity is `required: [names]`; the wire carries the
    /// per-property fold because that is `DynamicGenerationSchema.Property
    /// .isOptional`'s polarity. Absent means required (the safer default: a
    /// field the model may omit must be asked for explicitly).
    public let optional: Bool?
    public let schema: AISchemaNode
}

/// One declared tool on the generate wire (`{name, description?, schema}`).
/// The JS `tools` RECORD is folded to an ordered array at the edge — the
/// properties-wire idiom: declaration order is the order the definitions
/// reach the model-visible prompt, and a Swift dictionary decode would
/// shuffle it. (A record also makes duplicate names impossible at the call
/// site; the wire walk below still rejects them for a raw `__host` caller.)
public struct AIToolSpec: Decodable, Sendable {
    public let name: String
    /// What the tool does, for the model — FM puts it in the prompt.
    public let description: String?
    /// Argument schema — object-rooted, the same closed subset as
    /// `generateObject` (an FM `GenerationSchema` natively, either way).
    public let schema: AISchemaNode
}

/// The JS side's answer to one `ai.toolCall` push, as it crosses
/// `__host.toolResult(id, callId, replyJson)`: `{"result": <any JSON>}` when
/// the handler returned, `{"error": "<message>"}` when it threw. Parsed here
/// (Foundation-only, Linux-tested); the SDK-gated tool conformance only maps
/// the outcome onto `GeneratedContent` / a thrown `AIToolFailure`.
public enum AIToolReply: Equatable, Sendable {
    /// The handler's result, re-serialized to canonical JSON (fragments
    /// allowed — a tool may return a bare string/number/bool; keys sorted for
    /// determinism, since JSONSerialization dictionaries lose order anyway).
    case result(json: String)
    /// The handler failed; `message` is its error text, verbatim.
    case error(message: String)

    /// nil = malformed (not JSON, not an object, or neither key) — the
    /// SDK-gated caller turns that into a failed call, never a silent hang.
    public init?(json: String) {
        guard
            let object = try? JSONSerialization.jsonObject(
                with: Data(json.utf8)) as? [String: Any]
        else { return nil }
        if let message = object["error"] as? String {
            self = .error(message: message)
            return
        }
        guard object.keys.contains("result"),
            let data = try? JSONSerialization.data(
                withJSONObject: object["result"] ?? NSNull(),
                options: [.fragmentsAllowed, .sortedKeys]),
            let rendered = String(data: data, encoding: .utf8)
        else { return nil }
        self = .result(json: rendered)
    }
}

/// Thrown inside the SDK-gated tool conformance when JS reports `{error}` (or
/// replies malformed) — FoundationModels wraps it in
/// `LanguageModelSession.ToolCallError` and rethrows at the `respond` call
/// site, where the host maps it to `TOOL_FAILED` with this message.
public struct AIToolFailure: Error, Equatable, Sendable {
    public let message: String
    public init(message: String) { self.message = message }
}

/// Decodes a js/src/ai.ts generate request. The parsing/validation lives here
/// (Foundation-only) so it builds and is unit-tested on Linux — the FetchPlan
/// idiom; the SDK-gated host only maps a valid plan onto FoundationModels.
public struct GeneratePlan: Decodable, Sendable {
    public let prompt: String
    /// Optional system instructions for the session.
    public let instructions: String?
    /// 0–1; higher = more creative (`GenerationOptions.temperature`).
    public let temperature: Double?
    /// Cap on the response length (`GenerationOptions.maximumResponseTokens`)
    /// — CX-002.
    public let maxTokens: Int?
    /// True when the caller passed `onPartial`: cumulative snapshots ride the
    /// `ai.partial` native-event channel as they decode.
    public let stream: Bool?
    /// Coalescing floor for `ai.partial` pushes, ms (the `metricsIntervalMs`
    /// idiom). Bounds how often a snapshot may CROSS the bridge — every push
    /// commits a render — not how the model decodes. Absent = native default.
    public let partialIntervalMs: Double?
    /// Present for `generateObject`: guided generation against this schema.
    public let schema: AISchemaNode?
    /// Present when the caller declared tools: the model may invoke them
    /// mid-generation (the `ai.toolCall`/`toolResult` round trip).
    public let tools: [AIToolSpec]?

    public init?(json: String) {
        guard
            let plan = try? JSONDecoder().decode(
                GeneratePlan.self, from: Data(json.utf8)
            )
        else { return nil }
        self = plan
    }

    /// Streaming applies to the TEXT path only: `generateObject` settles once
    /// (structured partials are a recorded follow-up, not smuggled in here).
    public var wantsStream: Bool { stream == true && schema == nil }

    /// The schema's first problem, or nil (no schema = no problem).
    public func schemaProblem() -> String? { schema?.rootProblem() }

    /// First problem in the declared tools, or nil. Mirrors the JS-side
    /// `toolProblem` walk (that copy rejects at the call site, before the
    /// bridge; this one is the backstop the wire enforces). Tools with a
    /// response schema are refused: guided generation with tool calls is a
    /// recorded follow-up, and half-shipping it here would silently change
    /// what `generateObject` means.
    public func toolsProblem() -> String? {
        guard let tools, !tools.isEmpty else { return nil }
        if schema != nil {
            return "tools: not supported with a response schema (generateObject)"
        }
        var seen = Set<String>()
        for tool in tools {
            if tool.name.isEmpty { return "tools: tool name must not be empty" }
            if !seen.insert(tool.name).inserted {
                return "tools: duplicate tool \"\(tool.name)\""
            }
            if tool.schema.type != "object" {
                return "tools.\(tool.name): parameters root must be type "
                    + "\"object\", got \"\(tool.schema.type)\""
            }
            if let nested = tool.schema.problem(at: "tools.\(tool.name)") {
                return nested
            }
        }
        return nil
    }
}
