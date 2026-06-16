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
    /// Commands issued before discovery completes, replayed once ready.
    private var pendingWrites: [(String, String)] = []
    private var pendingSubscribes: [String] = []

    private struct Op: Decodable {
        let op: String
        let service: String?
        let characteristic: String?
        let value: String?
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
            if let c = op.characteristic, let v = op.value { write(c, v) }
        case "subscribe":
            if let c = op.characteristic { subscribe(c) }
        default:
            break
        }
    }

    // MARK: - Central

    private func connect(serviceUUID: String) {
        self.serviceUUID = CBUUID(string: serviceUUID)
        central = CBCentralManager(delegate: self, queue: nil)
    }

    private func disconnect() {
        if let peripheral { central?.cancelPeripheralConnection(peripheral) }
        peripheral = nil
        characteristics = [:]
        onState?("disconnected")
    }

    private func write(_ characteristic: String, _ value: String) {
        guard let peripheral, let ch = characteristics[characteristic] else {
            pendingWrites.append((characteristic, value))
            return
        }
        peripheral.writeValue(Data(value.utf8), for: ch, type: .withoutResponse)
    }

    private func subscribe(_ characteristic: String) {
        guard let peripheral, let ch = characteristics[characteristic] else {
            pendingSubscribes.append(characteristic)
            return
        }
        peripheral.setNotifyValue(true, for: ch)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            onState?("scanning")
            if let serviceUUID {
                central.scanForPeripherals(withServices: [serviceUUID])
            }
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
        onState?("disconnected")
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
        pendingWrites.forEach { write($0.0, $0.1) }
        pendingWrites = []
        pendingSubscribes.forEach { subscribe($0) }
        pendingSubscribes = []
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
