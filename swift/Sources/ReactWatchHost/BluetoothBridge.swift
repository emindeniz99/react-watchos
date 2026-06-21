import CoreBluetooth
import Foundation

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
    /// Characteristics the consumer asked to be notified on; re-applied on
    /// every (re)connect so notifications resume after a drop.
    private var desiredSubscriptions: Set<String> = []
    /// Writes issued before discovery completes, replayed once ready.
    private var pendingWrites: [(characteristic: String, value: String, confirm: Bool?)] = []
    /// True only for a user-initiated disconnect, so an unexpected drop can
    /// auto-reconnect while bleDisconnect() stays disconnected.
    private var userInitiatedDisconnect = false

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
        userInitiatedDisconnect = false
        self.serviceUUID = CBUUID(string: serviceUUID)
        if central == nil {
            // Delegate fires centralManagerDidUpdateState -> scan on power-on.
            central = CBCentralManager(delegate: self, queue: nil)
        } else {
            startScan()
        }
    }

    private func startScan() {
        guard let central, central.state == .poweredOn, let serviceUUID
        else { return }
        onState?("scanning")
        central.scanForPeripherals(withServices: [serviceUUID])
    }

    private func disconnect() {
        userInitiatedDisconnect = true
        if let peripheral { central?.cancelPeripheralConnection(peripheral) }
        peripheral = nil
        characteristics = [:]
        desiredSubscriptions = []
        onState?("disconnected")
    }

    private func write(_ characteristic: String, _ value: String, confirm: Bool?) {
        guard let peripheral, let ch = characteristics[characteristic] else {
            pendingWrites.append((characteristic, value, confirm))
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
        desiredSubscriptions.insert(characteristic)
        if let peripheral, let ch = characteristics[characteristic] {
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
        if !userInitiatedDisconnect { startScan() }
    }

    func centralManager(
        _ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral,
        error: Error?
    ) {
        self.peripheral = nil
        onState?("disconnected")
        if !userInitiatedDisconnect { startScan() }
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
            characteristics[ch.uuid.uuidString] = ch
            // CoreBluetooth uppercases short UUIDs; index both forms.
            characteristics[ch.uuid.uuidString.lowercased()] = ch
        }
        // (Re)apply desired subscriptions so notifications resume after a
        // reconnect, then flush any writes queued before discovery.
        for c in desiredSubscriptions {
            if let ch = characteristics[c] { peripheral.setNotifyValue(true, for: ch) }
        }
        pendingWrites.forEach { write($0.characteristic, $0.value, confirm: $0.confirm) }
        pendingWrites = []
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
