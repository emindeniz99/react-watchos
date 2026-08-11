import Foundation

/// A FIFO park for values a consumer isn't ready for yet, released only once
/// something ACTUALLY drains them — never merely because they were parked.
///
/// Generic and Foundation-only so the park/drain ordering is testable under
/// `swift test` without whatever native type isn't ready yet. The concrete
/// use is `PhoneConnectivity`'s inbound `watchConnectivity.file` channel
/// (ReactWatchHost, watchOS-only, untestable directly): a file event that
/// lands while `jsReady` is still false has nowhere to go — `pushNativeEvent`
/// reaches nobody before the bundle has evaluated — and the file it points to
/// is already on disk. Dropping the event doesn't just lose a notification,
/// it orphans that file: nothing else names its path, so retention prunes it
/// later with no diagnostic anywhere (the one DATA-LOSS class in this
/// package). Parking the event here instead — and NOT releasing whatever
/// keeps the file safe (`FileInbox`'s prune protection) until `drain()`
/// actually hands it back out — closes that window. `boot()` calls `drain()`
/// once `jsReady` flips true and replays what it returns.
public final class ParkedQueue<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [Value] = []

    public init() {}

    /// Appends `value`, preserving arrival order.
    public func park(_ value: Value) {
        lock.lock()
        defer { lock.unlock() }
        entries.append(value)
    }

    /// Returns every parked value in arrival order and empties the queue.
    /// Safe to call when nothing is parked (returns `[]`).
    @discardableResult
    public func drain() -> [Value] {
        lock.lock()
        defer { lock.unlock() }
        let drained = entries
        entries.removeAll()
        return drained
    }

    public var isEmpty: Bool {
        lock.lock()
        defer { lock.unlock() }
        return entries.isEmpty
    }
}
