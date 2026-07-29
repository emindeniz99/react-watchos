import Foundation

/// Operating budgets (ARCH-13). These are tripwires, not ceilings — like
/// every budget in docs/budgets-and-limits.md: crossing one emits a single
/// recoverable `budget` diagnostic (WARN) and the commit still renders;
/// rejecting the commit would desync `ackedSeq` and the optimistic store
/// (CX-010). Hysteresis: a budget that stays breached warns once per
/// CROSSING, re-arming only after the value drops back under — a 200 KB tree
/// at sensor-driven commit rates must not emit 10–20 diagnostics/sec.
///
/// Defaults are lib-internal; the JS-side mirror of the numbers lives in
/// js/src/budgets.ts (one constants module, checked pre-bridge in the
/// renderer) and must stay in sync until codegen can own both.
public struct BudgetPolicy: Sendable {
    /// Max live node instances in a committed tree (checked JS-side, where
    /// the instance map already knows the count; native never re-counts).
    public var maxNodes: Int
    /// Max serialized commit payload in bytes. Native checks true UTF-8
    /// bytes on the decode path (where the JSON string is already in hand);
    /// JS approximates with string length.
    public var maxCommitJSONBytes: Int
    /// Max wall-clock for one widget timeline render pass.
    public var maxWidgetRenderMs: Double
    /// Soft cap on one `transferFile` payload. OURS, provisional, unmeasured —
    /// Apple publishes no byte cap for `WCSession.transferFile`; what Apple
    /// does document is that it throttles delivery "to accommodate performance
    /// and power concerns" and that oversize/space failures surface as
    /// `WCError` (`.payloadTooLarge`, `.insufficientSpace`). So this is a
    /// tripwire like the rest: crossing it WARNS and the file still transfers,
    /// because WCError — not this number — is the authority on what is
    /// actually too large.
    public var maxTransferFileBytes: Int

    private enum Budget: Hashable {
        case nodes, commitJSONBytes, widgetRenderMs, transferFileBytes
    }

    /// Budgets currently in breach — the hysteresis state.
    private var over: Set<Budget> = []

    public init(
        maxNodes: Int = 1000,
        maxCommitJSONBytes: Int = 262_144,
        maxWidgetRenderMs: Double = 500,
        maxTransferFileBytes: Int = 1_048_576
    ) {
        self.maxNodes = maxNodes
        self.maxCommitJSONBytes = maxCommitJSONBytes
        self.maxWidgetRenderMs = maxWidgetRenderMs
        self.maxTransferFileBytes = maxTransferFileBytes
    }

    /// Checks the given measurements against their budgets and returns one
    /// `budget`-subsystem recoverable diagnostic per budget that just CROSSED
    /// its limit. A nil measurement leaves that budget's hysteresis state
    /// untouched; an under-budget measurement re-arms it.
    public mutating func check(
        nodeCount: Int? = nil,
        commitJSONBytes: Int? = nil,
        widgetRenderMs: Double? = nil,
        transferFileBytes: Int? = nil,
        sessionId: String, releaseId: String? = nil, target: Diagnostic.Target
    ) -> [Diagnostic] {
        var crossed: [(code: String, details: String)] = []
        if let nodeCount {
            if breach(.nodes, isOver: nodeCount > maxNodes) {
                crossed.append(
                    (
                        "budget.maxNodes",
                        "tree has \(nodeCount) nodes — over the maxNodes "
                            + "budget (\(maxNodes))"
                    ))
            }
        }
        if let commitJSONBytes {
            if breach(.commitJSONBytes, isOver: commitJSONBytes > maxCommitJSONBytes) {
                crossed.append(
                    (
                        "budget.maxCommitJSONBytes",
                        "commit JSON is \(commitJSONBytes) bytes — over the "
                            + "maxCommitJSONBytes budget (\(maxCommitJSONBytes))"
                    ))
            }
        }
        if let widgetRenderMs {
            if breach(.widgetRenderMs, isOver: widgetRenderMs > maxWidgetRenderMs) {
                crossed.append(
                    (
                        "budget.maxWidgetRenderMs",
                        String(
                            format: "widget render took %.1f ms — over the "
                                + "maxWidgetRenderMs budget (%.0f)",
                            widgetRenderMs, maxWidgetRenderMs)
                    ))
            }
        }
        if let transferFileBytes {
            if breach(
                .transferFileBytes, isOver: transferFileBytes > maxTransferFileBytes)
            {
                crossed.append(
                    (
                        "budget.maxTransferFileBytes",
                        "transferring a \(transferFileBytes)-byte file — over the "
                            + "maxTransferFileBytes budget (\(maxTransferFileBytes)); "
                            + "the watch radio is the dominant cost and WCSession "
                            + "throttles delivery"
                    ))
            }
        }
        return crossed.map { breach in
            Diagnostic(
                code: breach.code, severity: .recoverable, subsystem: .budget,
                sessionId: sessionId, releaseId: releaseId, target: target,
                details: breach.details)
        }
    }

    /// Updates the hysteresis state for `budget`; true only on the
    /// under → over edge.
    private mutating func breach(_ budget: Budget, isOver: Bool) -> Bool {
        guard isOver else {
            over.remove(budget)
            return false
        }
        return over.insert(budget).inserted
    }
}
