/// The BLE central's connection bookkeeping, pulled out of `BluetoothBridge`
/// so the parts that rot silently — the write queue that must replay after
/// discovery, the subscriptions that must re-apply after an unexpected
/// reconnect, and the latch that distinguishes a deliberate disconnect from a
/// dropped one — are pure value-type logic, unit-tested on Linux/macOS instead
/// of only on a watch with a real peripheral. CoreBluetooth I/O stays in the
/// bridge; this only tracks state. Keys are canonical UUIDs (see BluetoothUUID).
public struct BleSession: Sendable {
    public struct PendingWrite: Sendable, Equatable {
        public let characteristic: String
        public let value: String
        public let confirm: Bool?
        /// The invoke id awaiting this write's result, carried through the queue
        /// so a write issued before discovery still settles its JS promise once
        /// it's flushed and acked (CX-022). nil for a non-invoke write.
        public let invokeId: Int?

        public init(
            characteristic: String, value: String, confirm: Bool?,
            invokeId: Int? = nil
        ) {
            self.characteristic = characteristic
            self.value = value
            self.confirm = confirm
            self.invokeId = invokeId
        }
    }

    /// Writes issued before discovery completed, replayed in FIFO order once
    /// the characteristics are available.
    public private(set) var pendingWrites: [PendingWrite] = []
    /// Characteristics the consumer asked to be notified on; re-applied on
    /// every (re)connect so notifications resume after a drop.
    public private(set) var desiredSubscriptions: Set<String> = []
    /// True only after a user-requested disconnect, so an unexpected drop can
    /// auto-reconnect while a deliberate disconnect stays down.
    public private(set) var userInitiatedDisconnect = false

    public init() {}

    /// User asked to connect — clear the deliberate-disconnect latch so a
    /// later unexpected drop auto-reconnects.
    public mutating func beginConnect() {
        userInitiatedDisconnect = false
    }

    /// User asked to disconnect — latch it and forget what we wanted, so the
    /// next connect doesn't silently resurrect stale subscriptions or queued
    /// writes from before the disconnect.
    public mutating func endByUser() {
        userInitiatedDisconnect = true
        desiredSubscriptions = []
        pendingWrites = []
    }

    /// Queue a write that arrived before its characteristic was available.
    public mutating func queueWrite(
        characteristic: String, value: String, confirm: Bool?, invokeId: Int? = nil
    ) {
        pendingWrites.append(
            .init(
                characteristic: characteristic, value: value, confirm: confirm,
                invokeId: invokeId)
        )
    }

    /// Take and clear the queued writes to replay once discovery completes.
    public mutating func takePendingWrites() -> [PendingWrite] {
        defer { pendingWrites = [] }
        return pendingWrites
    }

    /// Remember a subscription so it re-applies on every (re)connect.
    public mutating func wantSubscription(_ characteristic: String) {
        desiredSubscriptions.insert(characteristic)
    }

    /// Whether an unexpected drop (range/power) should auto-reconnect.
    public var shouldAutoReconnect: Bool {
        !userInitiatedDisconnect
    }

    // MARK: - invoke result correlation (CX-022)

    // Which JS invoke id is awaiting which BLE op's delegate callback, so the
    // bridge can resolve/reject the right promise. Pure bookkeeping mirroring the
    // async CoreBluetooth machine: connect settles ONCE (not on every
    // auto-reconnect), `.withResponse` writes settle FIFO per characteristic on
    // didWriteValueFor, subscribes settle on didUpdateNotificationStateFor.
    // `.withoutResponse` writes never ack, so the bridge settles those itself
    // without touching this. The bridge decides resolve-vs-reject; this only
    // tracks *which id* settles, so it's Linux-unit-tested.

    /// The bleConnect id awaiting the first didConnect / didFailToConnect.
    public private(set) var pendingConnect: Int?
    /// `.withResponse` write ids awaiting didWriteValueFor, FIFO per characteristic.
    public private(set) var pendingWriteAcks: [String: [Int]] = [:]
    /// Subscribe ids awaiting didUpdateNotificationStateFor, per characteristic.
    public private(set) var pendingSubscribes: [String: Int] = [:]

    /// Record a bleConnect (`id`) awaiting the first connect. Returns a still-
    /// pending connect id (a re-entrant connect before the first settled), which
    /// the bridge must reject — only one connect promise is in flight at a time.
    public mutating func awaitConnect(id: Int) -> Int? {
        defer { pendingConnect = id }
        return pendingConnect
    }

    /// Take the connect-awaiting id (didConnect → resolve, didFailToConnect →
    /// reject). A later auto-reconnect finds nothing pending, so it never
    /// re-settles a promise.
    public mutating func takeConnectSettle() -> Int? {
        defer { pendingConnect = nil }
        return pendingConnect
    }

    /// Record a `.withResponse` write (`id`) awaiting its ack, FIFO per char.
    public mutating func awaitWriteAck(characteristic: String, id: Int) {
        pendingWriteAcks[characteristic, default: []].append(id)
    }

    /// didWriteValueFor fired: pop the oldest awaiting write id for this char.
    public mutating func takeWriteAck(characteristic: String) -> Int? {
        guard var queue = pendingWriteAcks[characteristic], !queue.isEmpty else {
            return nil
        }
        let id = queue.removeFirst()
        pendingWriteAcks[characteristic] = queue.isEmpty ? nil : queue
        return id
    }

    /// Record a subscribe (`id`) awaiting its notification-state ack. Returns a
    /// still-pending subscribe id for the same characteristic (a re-subscribe
    /// before the first settled) for the bridge to reject.
    public mutating func awaitSubscribe(characteristic: String, id: Int) -> Int? {
        defer { pendingSubscribes[characteristic] = id }
        return pendingSubscribes[characteristic]
    }

    /// Take the subscribe-awaiting id for this characteristic.
    public mutating func takeSubscribeSettle(characteristic: String) -> Int? {
        defer { pendingSubscribes[characteristic] = nil }
        return pendingSubscribes[characteristic]
    }

    /// Every in-flight invoke id — the connect, the writes awaiting an ack, the
    /// subscribes, AND the writes still queued before discovery — cleared. On a
    /// disconnect/drop (or a runtime swap) the bridge settles them all, because a
    /// hung promise is worse than a rejected one; a queued write whose discovery
    /// never arrives would otherwise leak forever. Does NOT touch
    /// desiredSubscriptions (those re-apply on reconnect).
    public mutating func takeAllPending() -> [Int] {
        var ids: [Int] = []
        if let connect = pendingConnect { ids.append(connect) }
        ids.append(contentsOf: pendingWriteAcks.values.flatMap { $0 })
        ids.append(contentsOf: pendingSubscribes.values)
        ids.append(contentsOf: pendingWrites.compactMap(\.invokeId))
        pendingConnect = nil
        pendingWriteAcks = [:]
        pendingSubscribes = [:]
        pendingWrites = []
        return ids
    }
}
