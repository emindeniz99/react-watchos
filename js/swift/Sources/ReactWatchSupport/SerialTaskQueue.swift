/// Runs async operations one at a time, in enqueue order — including each
/// operation's own internal `await`s, not just its synchronous prefix.
///
/// Swift actors (even `@MainActor`) are REENTRANT: awaiting inside an
/// actor-isolated method lets a second call to another isolated method
/// interleave at that suspension point. That is exactly the shape of the bug
/// this closes — `WorkoutPlanBridge.schedule` (ReactWatchHost, watchOS-only,
/// untestable directly) reads `scheduledWorkouts` to check a plan isn't
/// already there, `await`s WorkoutKit's own `schedule(_:at:)` (no error
/// channel, no return value — the read-back IS the result), then re-reads to
/// confirm. Two `Promise.all`'d calls scheduling the identical `(id, minute)`
/// pair can both pass the "not already scheduled" check before EITHER has
/// written (both reads land in the gap before the first write), and both
/// then write — WorkoutKit's own storage semantics for that duplicate call
/// are undocumented, so the safe answer is to make sure it can't happen.
///
/// `run` chains each operation's `Task` after the PREVIOUS one's `Task` has
/// fully completed (`await previous.value`), not just been submitted. The
/// chaining itself (`let previous = tail; tail = Task { ... }`) has no
/// `await` between reading and writing `tail`, so it cannot itself be
/// interleaved — the actor isolation on `tail` covers exactly the part that
/// needs to be atomic.
///
/// Foundation-free and generic so the mutual-exclusion guarantee is testable
/// under `swift test` without WorkoutKit standing in for the real race.
public actor SerialTaskQueue {
    private var tail: Task<Void, Never>?

    public init() {}

    /// Runs `operation` only after every previously enqueued operation has
    /// fully finished (including its own awaits), and returns its result.
    ///
    /// `operation` is `@MainActor`: the queue's own bookkeeping (`tail`) is
    /// isolated to ITSELF, not to the caller, but the intended use
    /// (`WorkoutPlanBridge`) is a `@MainActor` bridge whose helpers are
    /// MainActor-isolated too — this lets `operation`'s body call them
    /// directly instead of every caller re-hopping inside its closure.
    public func run<T: Sendable>(
        _ operation: @escaping @MainActor @Sendable () async -> T
    ) async -> T {
        let previous = tail
        let box = ResultBox<T>()
        let current = Task {
            _ = await previous?.value
            box.value = await operation()
        }
        tail = Task { await current.value }
        await current.value
        // `current` only completes after `box.value` is set, so this is safe.
        return box.value!
    }

    /// A single-write box: `run` is the only writer, and only after `current`
    /// (its own private `Task`) has finished, so there is no race on `value`
    /// despite the class not being actor-isolated itself.
    private final class ResultBox<T>: @unchecked Sendable {
        var value: T?
    }
}
