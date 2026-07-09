// watchOS-only host (WatchKit/UIKit/HealthKit/SwiftUI). The #if compiles this
// file to an empty module off-watchOS so `swift test` runs on macOS — see Package.swift.
#if os(watchOS)
import CoreBluetooth
import Foundation
import ReactWatchSupport

/// BLE central for talking to a peripheral (e.g. a laptop running a movie-
/// remote GATT service). watchOS only supports the central role, so the
/// watch scans/connects and the laptop must be the peripheral.
///
/// Two channels:
///   - `connect` / `write` / `subscribe` come in through `handleInvoke` and
///     **settle a JS promise** via onResolve/onReject (CX-022): a failed connect
///     or unacked write is no longer invisible. The id↔delegate correlation is
///     the pure (Linux-tested) `BleSession`; this only does CoreBluetooth I/O.
///   - `disconnect` stays a fire-and-forget op (`handleOp`); connection state
///     and characteristic notifications stream out through onState/onNotify
///     (wired to the JS native-event push channel in the host).
/// NOTE: the correlation logic is unit-tested, but the behaviour it correlates
/// (connect/drop/reconnect, write acks) only exists against a REAL peripheral —
/// device-gated, see docs/design-ble-result-reporting.md.
final class BluetoothBridge: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var onState: ((String) -> Void)?
    /// (characteristic, value, binary): `binary` is true when the payload was
    /// not valid UTF-8 and `value` is its base64 encoding — the same fallback
    /// contract as fetch response bodies (FetchPlan). Previously non-UTF-8
    /// notifications were silently coerced to "" (NF-13).
    var onNotify: ((_ characteristic: String, _ value: String, _ binary: Bool) -> Void)?
    /// Settle a bleConnect/bleWrite/bleSubscribe invoke: (invokeId, resultJson).
    var onResolve: ((Int, String) -> Void)?
    /// Reject one: (invokeId, errorJson `{code,message}` — code in the closed
    /// InvokeErrorCode set: INVALID_REQUEST / UNAVAILABLE / INTERNAL).
    var onReject: ((Int, String) -> Void)?

    /// How long a `bleConnect` waits for the first connection before rejecting,
    /// so a connect to an absent peripheral doesn't hang the JS promise forever.
    /// Injectable so the timeout-drain / epoch paths are unit-testable without a
    /// 15s real-time wait (see BluetoothBridgeTests).
    private let connectTimeout: TimeInterval

    /// Per-attempt auto-reconnect scan window (P0-1): how long each reconnect
    /// scan runs before that attempt is abandoned. Set from `bleConnect`
    /// options; default 60s. The attempt-count cap lives in `BleSession`.
    private var reconnectWindow: TimeInterval = 60

    init(connectTimeout: TimeInterval = 15) {
        self.connectTimeout = connectTimeout
        super.init()
    }

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var serviceUUID: CBUUID?
    private var characteristics: [String: CBCharacteristic] = [:]
    /// Connection bookkeeping (pending-write queue, desired subscriptions, the
    /// deliberate-vs-dropped disconnect latch, and the invoke↔delegate
    /// correlation) — pure logic in ReactWatchSupport, unit-tested off-device.
    private var session = BleSession()
    /// Services still discovering characteristics. Reaching 0 means every
    /// characteristic is known, so a subscribe/write to a UUID that's *still*
    /// absent can be rejected (not mistaken for "in a not-yet-discovered service").
    private var servicesAwaitingDiscovery = 0
    /// Bumped on every runtime swap. A connect-timeout closure captures the
    /// epoch it was armed under and no-ops if a reload has happened since, so it
    /// can't reject a NEW runtime's connect that reused the same invoke id (ids
    /// reset per runtime).
    private var connectEpoch = 0
    /// Bumped on every fresh connect AND every successful (re)connect. A
    /// reconnect scan-window captures it when armed: without this, a stale
    /// window from a PREVIOUS connection lifecycle whose attempt number happens
    /// to match the current one (both "attempt 1") would pass the count guard
    /// and cut the live attempt's window short, burning budget early.
    private var reconnectGeneration = 0

    /// A connection exists or is being established. Used to fast-reject a
    /// write/subscribe issued with no connect in flight, which would otherwise
    /// queue for a discovery that never arrives and hang the JS promise forever.
    private var isConnectedOrConnecting: Bool {
        peripheral != nil || session.pendingConnect != nil
    }

    /// The direct `ble` op channel — now only `disconnect` (connect/write/
    /// subscribe moved to handleInvoke so they can report a result).
    private struct Op: Decodable { let op: String }

    func handleOp(_ json: String) {
        guard let op = try? JSONDecoder().decode(Op.self, from: Data(json.utf8))
        else { return }
        if op.op == "disconnect" { disconnect() }
    }

    /// Payload for the invoke-routed ops.
    private struct InvokePayload: Decodable {
        let service: String?
        let characteristic: String?
        let value: String?
        let confirm: Bool?
        // Optional per-connection auto-reconnect config (P0-1).
        let maxReconnectAttempts: Int?
        let reconnectWindowMs: Double?
    }

    /// connect / write / subscribe via invoke — each settles a JS promise on the
    /// correlated CoreBluetooth delegate callback.
    func handleInvoke(id: Int, method: String, payload: String) {
        let p = try? JSONDecoder().decode(
            InvokePayload.self, from: Data(payload.utf8))
        switch method {
        case "bleConnect":
            guard let service = p?.service else {
                return reject(id, "INVALID_REQUEST", "bleConnect needs a service UUID")
            }
            // Reject a malformed UUID up front: CBUUID(string:) raises an uncaught
            // NSException, and connect()'s own guard would just drop a bad value
            // silently → the promise hangs to the 15s timeout. BluetoothUUID
            // accepts exactly what CBUUID does, and is Linux-tested.
            guard BluetoothUUID.canonical(service) != nil else {
                return reject(id, "INVALID_REQUEST", "malformed service UUID")
            }
            // Only one connect promise in flight: a re-entrant connect rejects
            // the stale one rather than leaving it hanging.
            if let stale = session.awaitConnect(id: id) {
                reject(stale, "INVALID_REQUEST", "superseded by a newer bleConnect")
            }
            // Apply per-connection reconnect config before connecting (P0-1).
            session.configureReconnect(maxAttempts: p?.maxReconnectAttempts)
            if let windowMs = p?.reconnectWindowMs {
                reconnectWindow = max(0, windowMs) / 1000
            }
            connect(serviceUUID: service)
            armConnectTimeout(id: id)
        case "bleWrite":
            guard let c = p?.characteristic, let v = p?.value else {
                return reject(id, "INVALID_REQUEST", "bleWrite needs characteristic + value")
            }
            guard BluetoothUUID.canonical(c) != nil else {
                return reject(id, "INVALID_REQUEST", "malformed characteristic UUID")
            }
            // No connection in flight → the write would queue for a discovery
            // that never arrives and hang forever. Fail fast instead.
            guard isConnectedOrConnecting else {
                return reject(id, "UNAVAILABLE", "not connected")
            }
            write(c, v, confirm: p?.confirm, invokeId: id)
        case "bleSubscribe":
            guard let c = p?.characteristic else {
                return reject(id, "INVALID_REQUEST", "bleSubscribe needs a characteristic")
            }
            guard let key = BluetoothUUID.canonical(c) else {
                return reject(id, "INVALID_REQUEST", "malformed characteristic UUID")
            }
            guard isConnectedOrConnecting else {
                return reject(id, "UNAVAILABLE", "not connected")
            }
            if let stale = session.awaitSubscribe(characteristic: key, id: id) {
                reject(stale, "INVALID_REQUEST", "superseded by a newer bleSubscribe")
            }
            subscribe(c)
        default:
            reject(id, "INTERNAL", "no BLE invoke handler for \(method)")
        }
    }

    private func resolve(_ id: Int, _ json: String = "") { onResolve?(id, json) }

    private func reject(_ id: Int, _ code: String, _ message: String) {
        // Shared JSON-safe builder: the hand-built version escaped only double
        // quotes, so a backslash/newline in a peripheral-supplied message made
        // the errorJson unparseable and JS lost the typed rejection.
        onReject?(id, InvokeErrorJSON.make(code: code, message: message))
    }

    /// Reject EVERY in-flight promise — the connect AND any write/subscribe that
    /// was queued while connecting — on a failed or lost connection. Single-
    /// sourced so no failure path can drain only the connect and leak the queued
    /// ops: the verify pass found exactly that divergence in didFailToConnect.
    private func failPendingOps(_ message: String) {
        for id in session.takeAllPending() {
            reject(id, "UNAVAILABLE", message)
        }
    }

    /// A connection ATTEMPT failed (didFailToConnect, no peripheral was ever
    /// connected): tear down, settle every in-flight promise, and auto-reconnect
    /// unless the consumer asked to disconnect. Factored out so it's unit-testable
    /// (the delegate callback needs a real CBPeripheral) and shares the drain.
    func failConnectionAttempt(message: String) {
        peripheral = nil
        onState?("disconnected")
        failPendingOps(message)
        attemptReconnect()
    }

    /// Begin (or continue) a BOUNDED auto-reconnect: if the attempt budget
    /// allows, scan and arm a scan-window timeout for this attempt. Returns
    /// false when no attempt started — the consumer disconnected deliberately
    /// or the budget is spent (P0-1) — so the radio can't active-scan forever
    /// for a peripheral that never returns. The drop paths already pushed
    /// "disconnected"; only the window-expiry caller pushes the terminal state.
    @discardableResult
    private func attemptReconnect() -> Bool {
        guard session.beginReconnectAttempt() else { return false }
        startScan()
        armReconnectWindow(
            epoch: connectEpoch, generation: reconnectGeneration,
            attempt: session.reconnectAttempts)
        return true
    }

    /// Abandon this reconnect scan if it hasn't connected within the window,
    /// then move to the next attempt (or terminal). Mirrors `armConnectTimeout`
    /// — epoch/generation-guarded so a stale window (previous runtime, or a
    /// previous connection lifecycle) can't fire into the live one.
    private func armReconnectWindow(epoch: Int, generation: Int, attempt: Int) {
        nonisolated(unsafe) let bridge = self
        DispatchQueue.main.asyncAfter(deadline: .now() + reconnectWindow) {
            bridge.handleReconnectWindowExpiry(
                epoch: epoch, generation: generation, attempt: attempt)
        }
    }

    /// The reconnect-window firing, factored out for deterministic unit tests.
    /// No-ops unless we're still scanning for THIS attempt: same epoch and
    /// connection generation, nothing connected since (peripheral == nil), the
    /// attempt count is unchanged, and the consumer hasn't disconnected. Going
    /// terminal (budget spent) pushes the final "disconnected" — the last state
    /// the JS side saw from this window was "scanning".
    func handleReconnectWindowExpiry(epoch: Int, generation: Int, attempt: Int) {
        guard connectEpoch == epoch, reconnectGeneration == generation,
            peripheral == nil, session.reconnectAttempts == attempt,
            !session.userInitiatedDisconnect
        else { return }
        central?.stopScan()
        if !attemptReconnect() { onState?("disconnected") }
    }

    /// Reject this connect if it's still the pending one after the timeout (it
    /// connected → already cleared; superseded → no longer this id).
    private func armConnectTimeout(id: Int) {
        // The bridge is main-confined (CBCentralManager queue: nil delivers on
        // main, and the host calls in on main), and this closure runs on main —
        // nonisolated(unsafe) is the same self-capture pattern the other bridges
        // use for their async callbacks.
        nonisolated(unsafe) let bridge = self
        let epoch = connectEpoch
        DispatchQueue.main.asyncAfter(deadline: .now() + connectTimeout) {
            bridge.handleConnectTimeout(id: id, epoch: epoch)
        }
    }

    /// The connect-timeout firing, factored out of the asyncAfter closure so the
    /// drain + epoch logic is deterministically unit-testable (no 15s wait).
    /// No-ops unless this id is still the pending connect AND no reload has
    /// bumped the epoch since the timeout was armed — a stale timeout from a
    /// previous runtime must not reject a new connect that reused the same id.
    func handleConnectTimeout(id: Int, epoch: Int) {
        guard connectEpoch == epoch, session.pendingConnect == id else { return }
        central?.stopScan()
        // Reject the connect AND any write/subscribe queued while it was in
        // flight — they were all waiting on a connection that never came.
        failPendingOps("connect timed out")
    }

    // MARK: - Central

    private func connect(serviceUUID: String) {
        session.beginConnect()
        // New connection lifecycle: orphan any scan-window armed by the old one.
        reconnectGeneration &+= 1
        // CBUUID(string:) raises an uncaught NSException on a malformed UUID,
        // which would crash the whole app from untrusted JS input — validate
        // the format first and ignore a bad value instead.
        guard let uuid = Self.makeCBUUID(serviceUUID) else { return }
        self.serviceUUID = uuid
        if central == nil {
            // Delegate fires centralManagerDidUpdateState -> scan on power-on.
            central = CBCentralManager(delegate: self, queue: nil)
        } else {
            startScan()
        }
    }

    /// A CBUUID for `string` if it's a form CBUUID accepts — a 16-bit (4 hex)
    /// or 32-bit (8 hex) short UUID, or a full 128-bit UUID in canonical
    /// 8-4-4-4-12 dashed form. Returns nil for anything else so CBUUID's
    /// exception-raising initializer is never handed an invalid string.
    private static func makeCBUUID(_ string: String) -> CBUUID? {
        let hex = string.replacingOccurrences(of: "-", with: "")
        guard !hex.isEmpty, hex.allSatisfy(\.isHexDigit) else { return nil }
        if string == hex, hex.count == 4 || hex.count == 8 {
            return CBUUID(string: string)
        }
        if hex.count == 32, string.count == 36 {
            return CBUUID(string: string)
        }
        return nil
    }

    private func startScan() {
        guard let central, central.state == .poweredOn, let serviceUUID
        else { return }
        onState?("scanning")
        central.scanForPeripherals(withServices: [serviceUUID])
    }

    private func disconnect() {
        // Stop any in-flight auto-reconnect scan first: when the drop happened
        // while scanning (peripheral == nil), nothing else here stops it, so the
        // BLE radio would keep active-scanning after the user disconnected.
        central?.stopScan()
        // Reject every in-flight promise (connect/write/subscribe AND queued
        // writes) before tearing down — drained BEFORE endByUser, which clears
        // the queue, or the queued-write ids would be lost (leaked promise).
        failPendingOps("disconnected")
        session.endByUser()
        if let peripheral {
            // cancelPeripheralConnection → didDisconnectPeripheral pushes the one
            // "disconnected" state; pushing it here too would duplicate it.
            central?.cancelPeripheralConnection(peripheral)
        } else {
            onState?("disconnected")
        }
        peripheral = nil
        characteristics = [:]
    }

    /// Clear the per-runtime invoke correlation on a reload, so a delegate
    /// callback that lands after the runtime was swapped can't settle the NEW
    /// runtime's promise with a stale id (invoke ids reset per runtime). The
    /// connection + desiredSubscriptions survive the hot-reload; only the
    /// in-flight correlation is dropped (the old runtime's promises are gone).
    func resetPendingForReload() {
        _ = session.takeAllPending()
        // Invalidate any in-flight connect timeout armed by the old runtime, so
        // it can't reject a new connect that reuses the same (reset) invoke id.
        connectEpoch &+= 1
        // That bump also orphaned any armed scan-window. If a (re)connect scan
        // is still running, re-arm under the new epoch so the surviving scan
        // stays BOUNDED — otherwise a reload mid-scan reintroduces exactly the
        // unbounded radio drain the attempt budget removed (P0-1).
        if central?.isScanning == true, peripheral == nil {
            armReconnectWindow(
                epoch: connectEpoch, generation: reconnectGeneration,
                attempt: session.reconnectAttempts)
        }
    }

    private func write(
        _ characteristic: String, _ value: String, confirm: Bool?,
        invokeId: Int? = nil
    ) {
        let key = BluetoothUUID.canonical(characteristic) ?? characteristic
        guard let peripheral, let ch = characteristics[key] else {
            // Queue with the invoke id so it still settles once flushed + acked.
            session.queueWrite(
                characteristic: key, value: value, confirm: confirm,
                invokeId: invokeId)
            return
        }
        let type: CBCharacteristicWriteType =
            if let confirm {
                confirm ? .withResponse : .withoutResponse
            } else {
                // Default: reliable (acknowledged) when the characteristic supports
                // it, so a command isn't silently dropped under buffer pressure.
                ch.properties.contains(.write) ? .withResponse : .withoutResponse
            }
        peripheral.writeValue(Data(value.utf8), for: ch, type: type)
        guard let invokeId else { return }
        if type == .withResponse {
            // Settles on didWriteValueFor (correlated FIFO per characteristic).
            session.awaitWriteAck(characteristic: key, id: invokeId)
        } else {
            // .withoutResponse never acks — resolve optimistically (handed to
            // CoreBluetooth, not confirmed delivered). Documented in bluetooth.ts.
            resolve(invokeId)
        }
    }

    private func subscribe(_ characteristic: String) {
        let key = BluetoothUUID.canonical(characteristic) ?? characteristic
        session.wantSubscription(key)
        if let peripheral, let ch = characteristics[key] {
            peripheral.setNotifyValue(true, for: ch)
        }
        // If not yet discovered, the subscribe invoke settles when discovery
        // (re)applies it and didUpdateNotificationStateFor fires.
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            startScan()
        case .unauthorized:
            onState?("unauthorized")
        case .poweredOff:
            onState?("poweredOff")
        default:
            break
        }
    }

    func centralManager(
        _ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
        advertisementData _: [String: Any], rssi _: NSNumber
    ) {
        central.stopScan()
        // Only connect if this discovery belongs to a live connect/auto-reconnect
        // intent. A scan that outlived a user disconnect (or landed just as one
        // arrived) must not silently reconnect the peripheral the user dropped.
        guard session.shouldAutoReconnect else { return }
        self.peripheral = peripheral
        peripheral.delegate = self
        central.connect(peripheral)
    }

    func centralManager(
        _: CBCentralManager, didConnect peripheral: CBPeripheral
    ) {
        // A successful connect clears the reconnect budget, so a later drop
        // gets a fresh set of attempts rather than inheriting a spent count.
        // The generation bump orphans this scan's own armed window — without it
        // a stale window could match a LATER drop's identical attempt number
        // and cut that attempt short.
        session.noteConnected()
        reconnectGeneration &+= 1
        onState?("connected")
        // Resolve the bleConnect promise on the FIRST connect; a later
        // auto-reconnect finds nothing pending, so it never re-resolves.
        if let id = session.takeConnectSettle() { resolve(id) }
        peripheral.discoverServices(serviceUUID.map { [$0] })
    }

    func centralManager(
        _: CBCentralManager, didDisconnectPeripheral _: CBPeripheral,
        error _: Error?
    ) {
        peripheral = nil
        characteristics = [:]
        onState?("disconnected")
        // A drop mid-write/subscribe must settle those promises, not hang JS.
        failPendingOps("disconnected")
        // Bounded auto-reconnect on an unexpected drop (range/power); stays down
        // if the consumer called bleDisconnect() or the attempt budget is spent.
        attemptReconnect()
    }

    func centralManager(
        _: CBCentralManager, didFailToConnect _: CBPeripheral,
        error _: Error?
    ) {
        // Drain ALL pending — not just the connect: a write/subscribe issued
        // while connecting (permitted by isConnectedOrConnecting) must not
        // outlive the failed attempt.
        failConnectionAttempt(message: "failed to connect")
    }

    // MARK: - Peripheral

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices _: Error?) {
        let services = peripheral.services ?? []
        servicesAwaitingDiscovery = services.count
        if services.isEmpty {
            finishDiscovery(peripheral)  // nothing to discover → settle absent ops
        }
        services.forEach { peripheral.discoverCharacteristics(nil, for: $0) }
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService, error _: Error?
    ) {
        for ch in service.characteristics ?? [] {
            // Key by the canonical 128-bit form so a write/subscribe by either
            // the short ("2A37") or full UUID, in any case, resolves here —
            // CoreBluetooth reports standard UUIDs in short form. See CR-10.
            let key = BluetoothUUID.canonical(ch.uuid.uuidString) ?? ch.uuid.uuidString
            characteristics[key] = ch
        }
        servicesAwaitingDiscovery -= 1
        if servicesAwaitingDiscovery <= 0 { finishDiscovery(peripheral) }
    }

    /// All characteristics are now known. (Re)apply subscriptions and flush
    /// queued writes — and crucially, **reject** any subscribe/write whose
    /// characteristic genuinely isn't on the peripheral, so a typo'd or
    /// unsupported UUID rejects its promise instead of hanging forever (CX-022).
    private func finishDiscovery(_ peripheral: CBPeripheral) {
        for c in session.desiredSubscriptions {
            if let ch = characteristics[c] { peripheral.setNotifyValue(true, for: ch) }
        }
        // A pending subscribe to an absent characteristic never gets a
        // setNotifyValue, so didUpdateNotificationStateFor would never settle it.
        for (char, id) in session.pendingSubscribes
        where characteristics[char] == nil {
            _ = session.takeSubscribeSettle(characteristic: char)
            reject(id, "UNAVAILABLE", "characteristic not found")
        }
        // Flush queued writes; reject (don't silently re-queue) those whose
        // characteristic is absent — a re-queue that can never flush is a hang.
        for w in session.takePendingWrites() {
            if characteristics[w.characteristic] != nil {
                write(
                    w.characteristic, w.value, confirm: w.confirm,
                    invokeId: w.invokeId)
            } else if let id = w.invokeId {
                reject(id, "UNAVAILABLE", "characteristic not found")
            }
        }
    }

    func peripheral(
        _: CBPeripheral,
        didWriteValueFor characteristic: CBCharacteristic, error: Error?
    ) {
        let key =
            BluetoothUUID.canonical(characteristic.uuid.uuidString)
            ?? characteristic.uuid.uuidString
        guard let id = session.takeWriteAck(characteristic: key) else { return }
        if let error {
            reject(id, "INTERNAL", error.localizedDescription)
        } else {
            resolve(id)
        }
    }

    func peripheral(
        _: CBPeripheral,
        didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        let key =
            BluetoothUUID.canonical(characteristic.uuid.uuidString)
            ?? characteristic.uuid.uuidString
        guard let id = session.takeSubscribeSettle(characteristic: key) else { return }
        if let error {
            reject(id, "INTERNAL", error.localizedDescription)
        } else {
            resolve(id)
        }
    }

    func peripheral(
        _: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic, error _: Error?
    ) {
        let data = characteristic.value ?? Data()
        if let text = String(data: data, encoding: .utf8) {
            onNotify?(characteristic.uuid.uuidString, text, false)
        } else {
            // Same base64 fallback contract as fetch bodies (FetchPlan):
            // non-UTF-8 used to be coerced to "" — silent data loss (NF-13).
            onNotify?(
                characteristic.uuid.uuidString, data.base64EncodedString(), true)
        }
    }
}
#endif
