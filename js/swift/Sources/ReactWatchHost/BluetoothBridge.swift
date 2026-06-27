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
    var onNotify: ((_ characteristic: String, _ value: String) -> Void)?
    /// Settle a bleConnect/bleWrite/bleSubscribe invoke: (invokeId, resultJson).
    var onResolve: ((Int, String) -> Void)?
    /// Reject one: (invokeId, errorJson `{code,message}` — code in the closed
    /// InvokeErrorCode set: INVALID_REQUEST / UNAVAILABLE / INTERNAL).
    var onReject: ((Int, String) -> Void)?

    /// How long a `bleConnect` waits for the first connection before rejecting,
    /// so a connect to an absent peripheral doesn't hang the JS promise forever.
    private let connectTimeout: TimeInterval = 15

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var serviceUUID: CBUUID?
    private var characteristics: [String: CBCharacteristic] = [:]
    /// Connection bookkeeping (pending-write queue, desired subscriptions, the
    /// deliberate-vs-dropped disconnect latch, and the invoke↔delegate
    /// correlation) — pure logic in ReactWatchSupport, unit-tested off-device.
    private var session = BleSession()

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
            // Only one connect promise in flight: a re-entrant connect rejects
            // the stale one rather than leaving it hanging.
            if let stale = session.awaitConnect(id: id) {
                reject(stale, "INVALID_REQUEST", "superseded by a newer bleConnect")
            }
            connect(serviceUUID: service)
            armConnectTimeout(id: id)
        case "bleWrite":
            guard let c = p?.characteristic, let v = p?.value else {
                return reject(id, "INVALID_REQUEST", "bleWrite needs characteristic + value")
            }
            write(c, v, confirm: p?.confirm, invokeId: id)
        case "bleSubscribe":
            guard let c = p?.characteristic else {
                return reject(id, "INVALID_REQUEST", "bleSubscribe needs a characteristic")
            }
            let key = BluetoothUUID.canonical(c) ?? c
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
        // Hand-built so a peripheral-supplied message can't break the JSON.
        let safe = message.replacingOccurrences(of: "\"", with: "'")
        onReject?(id, "{\"code\":\"\(code)\",\"message\":\"\(safe)\"}")
    }

    /// Reject this connect if it's still the pending one after the timeout (it
    /// connected → already cleared; superseded → no longer this id).
    private func armConnectTimeout(id: Int) {
        // The bridge is main-confined (CBCentralManager queue: nil delivers on
        // main, and the host calls in on main), and this closure runs on main —
        // nonisolated(unsafe) is the same self-capture pattern the other bridges
        // use for their async callbacks.
        nonisolated(unsafe) let bridge = self
        DispatchQueue.main.asyncAfter(deadline: .now() + connectTimeout) {
            guard bridge.session.pendingConnect == id,
                let pending = bridge.session.takeConnectSettle()
            else { return }
            bridge.central?.stopScan()
            bridge.reject(pending, "UNAVAILABLE", "connect timed out")
        }
    }

    // MARK: - Central

    private func connect(serviceUUID: String) {
        session.beginConnect()
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
        session.endByUser()
        // A deliberate disconnect rejects any in-flight connect/write/subscribe
        // promise instead of leaving JS awaiting forever.
        for id in session.takeAllPending() {
            reject(id, "UNAVAILABLE", "disconnected")
        }
        if let peripheral { central?.cancelPeripheralConnection(peripheral) }
        peripheral = nil
        characteristics = [:]
        onState?("disconnected")
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
        self.peripheral = peripheral
        peripheral.delegate = self
        central.connect(peripheral)
    }

    func centralManager(
        _: CBCentralManager, didConnect peripheral: CBPeripheral
    ) {
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
        for id in session.takeAllPending() {
            reject(id, "UNAVAILABLE", "disconnected")
        }
        // Auto-reconnect on an unexpected drop (range/power); stay down if the
        // consumer called bleDisconnect().
        if session.shouldAutoReconnect { startScan() }
    }

    func centralManager(
        _: CBCentralManager, didFailToConnect _: CBPeripheral,
        error _: Error?
    ) {
        peripheral = nil
        onState?("disconnected")
        if let id = session.takeConnectSettle() {
            reject(id, "UNAVAILABLE", "failed to connect")
        }
        if session.shouldAutoReconnect { startScan() }
    }

    // MARK: - Peripheral

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices _: Error?) {
        peripheral.services?.forEach { peripheral.discoverCharacteristics(nil, for: $0) }
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
        // (Re)apply desired subscriptions so notifications resume after a
        // reconnect, then flush any writes queued before discovery (carrying
        // their invoke ids so the promises settle).
        for c in session.desiredSubscriptions {
            if let ch = characteristics[c] { peripheral.setNotifyValue(true, for: ch) }
        }
        for w in session.takePendingWrites() {
            write(w.characteristic, w.value, confirm: w.confirm, invokeId: w.invokeId)
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
        let value =
            characteristic.value
            .flatMap { String(data: $0, encoding: .utf8) } ?? ""
        onNotify?(characteristic.uuid.uuidString, value)
    }
}
#endif
