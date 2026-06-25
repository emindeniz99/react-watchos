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

        public init(characteristic: String, value: String, confirm: Bool?) {
            self.characteristic = characteristic
            self.value = value
            self.confirm = confirm
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
    public mutating func beginConnect() { userInitiatedDisconnect = false }

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
        characteristic: String, value: String, confirm: Bool?
    ) {
        pendingWrites.append(
            .init(characteristic: characteristic, value: value, confirm: confirm))
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
    public var shouldAutoReconnect: Bool { !userInitiatedDisconnect }
}
