import ReactWatchCore

/// Tracks optimistic control values keyed by node id: when the user flips a
/// Toggle / drags a Slider, the UI shows the new value immediately while the
/// dispatch is in flight, then drops it once React acks (a commit whose
/// `seq` caught up). Pure value type — no SwiftUI — so the interaction logic
/// that used to live inline in the @MainActor model is unit-tested on Linux.
public struct OptimisticStore: Sendable {
    private var values: [Int: (seq: Int, value: JSONValue)] = [:]

    public init() {}

    public var isEmpty: Bool { values.isEmpty }

    /// Records `value` for `nodeId`, held until a commit acks `seq`.
    public mutating func set(nodeId: Int, seq: Int, value: JSONValue) {
        values[nodeId] = (seq, value)
    }

    /// Drops every entry React has caught up to (commit `seq` >= its dispatch).
    public mutating func ack(throughSeq seq: Int) {
        values = values.filter { $0.value.seq > seq }
    }

    public func bool(_ nodeId: Int) -> Bool? {
        if case .bool(let value)? = values[nodeId]?.value { return value }
        return nil
    }

    public func int(_ nodeId: Int) -> Int? {
        if case .number(let value)? = values[nodeId]?.value { return Int(value) }
        return nil
    }

    public func double(_ nodeId: Int) -> Double? {
        if case .number(let value)? = values[nodeId]?.value { return value }
        return nil
    }
}
