/// Canonicalizes Bluetooth UUID strings so the BLE bridge keys characteristics
/// consistently. CoreBluetooth reports standard UUIDs in 16-bit short form
/// ("2A37"), but JS may pass the short form, the full 128-bit form, or any
/// case — all the same UUID. Expanding every form to one canonical 128-bit
/// string lets a write/subscribe by the full form still find a characteristic
/// stored under its short form. Pure string logic (no CoreBluetooth), so it's
/// unit-tested on Linux/macOS instead of only on a watch with a real peripheral.
public enum BluetoothUUID {
    /// The Bluetooth Base UUID tail that 16/32-bit short UUIDs expand into.
    private static let baseSuffix = "-0000-1000-8000-00805F9B34FB"

    /// Canonical uppercase 128-bit form, or nil for anything CBUUID wouldn't
    /// accept (mirrors BluetoothBridge.makeCBUUID's acceptance: a 16-bit
    /// "XXXX", a 32-bit "XXXXXXXX", or a dashed 8-4-4-4-12 128-bit string).
    public static func canonical(_ string: String) -> String? {
        let hex = string.replacingOccurrences(of: "-", with: "").uppercased()
        guard !hex.isEmpty, hex.allSatisfy(\.isHexDigit) else { return nil }
        switch (hex.count, string.count) {
        case (4, 4): // 16-bit short, no dashes
            return "0000\(hex)\(baseSuffix)"
        case (8, 8): // 32-bit short, no dashes
            return "\(hex)\(baseSuffix)"
        case (32, 36): // full 128-bit, canonical dashed form
            let c = Array(hex)
            return "\(String(c[0 ..< 8]))-\(String(c[8 ..< 12]))-\(String(c[12 ..< 16]))"
                + "-\(String(c[16 ..< 20]))-\(String(c[20 ..< 32]))"
        default:
            return nil
        }
    }
}
