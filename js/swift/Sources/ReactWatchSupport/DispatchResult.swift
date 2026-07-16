import Foundation

/// Structured verdict of a `__dispatchEvent` round trip (ARCH-09): JS returns
/// `{handled, accepted, reason?}` as a JSON string so navigation is a
/// request/confirm transaction instead of a fire-and-forget whose boolean the
/// host discarded. `handled` = a handler prop ran; `accepted` = the proposal
/// took effect (for `pathChange`, JS compares the committed path against the
/// proposed one after its synchronous flush). Hand-written mirror of the
/// renderer's `DispatchResult`.
// TODO(codegen): fold into schema.ts when codegen is runnable.
public struct DispatchResult: Codable, Sendable {
    public let handled: Bool
    public let accepted: Bool
    public let reason: String?

    public init(handled: Bool, accepted: Bool, reason: String? = nil) {
        self.handled = handled
        self.accepted = accepted
        self.reason = reason
    }

    /// Decodes the bridge's JSON verdict. nil or undecodable JSON — a missing
    /// `__dispatchEvent` global or a thrown JS handler (JS_Call yields no
    /// result) — maps to `(handled: false, accepted: false, "no result")`,
    /// which callers treat as an immediate rollback per the ARCH-09
    /// acceptance rule.
    public static func parse(_ json: String?) -> DispatchResult {
        guard let json,
            let decoded = try? JSONDecoder().decode(
                DispatchResult.self, from: Data(json.utf8))
        else {
            return DispatchResult(
                handled: false, accepted: false, reason: "no result")
        }
        return decoded
    }
}
