// watchOS-only host (WatchKit/UIKit/HealthKit/SwiftUI). The #if compiles this
// file to an empty module off-watchOS so `swift test` runs on macOS — see Package.swift.
#if os(watchOS)
import CoreBluetooth
import Foundation
import ReactWatchSupport

/// BLE central for talking to a peripheral (e.g. a laptop running a movie-
/// remote GATT service). watchOS only supports the central role, so the
/// watch scans/connects and the laptop must be the peripheral. Commands
/// come from JS via handleOp; connection state and characteristic
/// notifications go back out through onState/onNotify (wired to the JS
/// native-event push channel in WatchApp).
/// NOTE: untested until built with Xcode on macOS + a real peripheral.
final class BluetoothBridge: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var onState: ((String) -> Void)?
    var onNotify: ((_ characteristic: String, _ value: String) -> Void)?

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var serviceUUID: CBUUID?
    private var characteristics: [String: CBCharacteristic] = [:]
    /// Connection bookkeeping (pending-write queue, desired subscriptions, the
    /// deliberate-vs-dropped disconnect latch) — pure logic in ReactWatchSupport
    /// so it's unit-tested off-device. CoreBluetooth I/O stays here.
    private var session = BleSession()

    private struct Op: Decodable {
        let op: String
        let service: String?
        let characteristic: String?
        let value: String?
        let confirm: Bool?
    }

    /// Entry point for JS BLE ops ({ op, ... } from js/src/bluetooth.ts).
    func handleOp(_ json: String) {
        guard let op = try? JSONDecoder().decode(Op.self, from: Data(json.utf8))
        else { return }
        switch op.op {
        case "connect":
            if let service = op.service { connect(serviceUUID: service) }
        case "disconnect":
            disconnect()
        case "write":
            if let c = op.characteristic, let v = op.value {
                write(c, v, confirm: op.confirm)
            }
        case "subscribe":
            if let c = op.characteristic { subscribe(c) }
        default:
            break
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
        if let peripheral { central?.cancelPeripheralConnection(peripheral) }
        peripheral = nil
        characteristics = [:]
        onState?("disconnected")
    }

    private func write(_ characteristic: String, _ value: String, confirm: Bool?) {
        let key = BluetoothUUID.canonical(characteristic) ?? characteristic
        guard let peripheral, let ch = characteristics[key] else {
            session.queueWrite(characteristic: key, value: value, confirm: confirm)
            return
        }
        let type: CBCharacteristicWriteType
        if let confirm {
            type = confirm ? .withResponse : .withoutResponse
        } else {
            // Default: reliable (acknowledged) when the characteristic supports
            // it, so a command isn't silently dropped under buffer pressure.
            type = ch.properties.contains(.write) ? .withResponse : .withoutResponse
        }
        peripheral.writeValue(Data(value.utf8), for: ch, type: type)
    }

    private func subscribe(_ characteristic: String) {
        let key = BluetoothUUID.canonical(characteristic) ?? characteristic
        session.wantSubscription(key)
        if let peripheral, let ch = characteristics[key] {
            peripheral.setNotifyValue(true, for: ch)
        }
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
        advertisementData: [String: Any], rssi RSSI: NSNumber
    ) {
        central.stopScan()
        self.peripheral = peripheral
        peripheral.delegate = self
        central.connect(peripheral)
    }

    func centralManager(
        _ central: CBCentralManager, didConnect peripheral: CBPeripheral
    ) {
        onState?("connected")
        peripheral.discoverServices(serviceUUID.map { [$0] })
    }

    func centralManager(
        _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
        error: Error?
    ) {
        self.peripheral = nil
        characteristics = [:]
        onState?("disconnected")
        // Auto-reconnect on an unexpected drop (range/power); stay down if the
        // consumer called bleDisconnect().
        if session.shouldAutoReconnect { startScan() }
    }

    func centralManager(
        _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral,
        error: Error?
    ) {
        self.peripheral = nil
        onState?("disconnected")
        if session.shouldAutoReconnect { startScan() }
    }

    // MARK: - Peripheral

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        peripheral.services?.forEach { peripheral.discoverCharacteristics(nil, for: $0) }
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService, error: Error?
    ) {
        for ch in service.characteristics ?? [] {
            // Key by the canonical 128-bit form so a write/subscribe by either
            // the short ("2A37") or full UUID, in any case, resolves here —
            // CoreBluetooth reports standard UUIDs in short form. See CR-10.
            let key = BluetoothUUID.canonical(ch.uuid.uuidString) ?? ch.uuid.uuidString
            characteristics[key] = ch
        }
        // (Re)apply desired subscriptions so notifications resume after a
        // reconnect, then flush any writes queued before discovery.
        for c in session.desiredSubscriptions {
            if let ch = characteristics[c] { peripheral.setNotifyValue(true, for: ch) }
        }
        for w in session.takePendingWrites() {
            write(w.characteristic, w.value, confirm: w.confirm)
        }
    }

    func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic, error: Error?
    ) {
        let value = characteristic.value
            .flatMap { String(data: $0, encoding: .utf8) } ?? ""
        onNotify?(characteristic.uuid.uuidString, value)
    }
}
#endif
