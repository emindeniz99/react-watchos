// Native capability bridges routed through the invoke channel: device info,
// Keychain, speech synthesis, extended runtime sessions, and StoreKit 2. Each
// is watchOS-gated (the whole file compiles out off-watchOS, like the rest of
// ReactWatchHost). The invoke routing + settling lives in the ReactWatchModel
// extension in ReactWatchHost.swift; this file is the framework glue.
#if os(watchOS)
import AVFoundation
import Foundation
import Security
import StoreKit
import WatchKit

// MARK: - Device snapshot (WKInterfaceDevice)

enum DeviceSnapshot {
    /// A plist/JSON-safe snapshot matching the JS `DeviceInfo` shape.
    static func current() -> [String: Any] {
        let device = WKInterfaceDevice.current()
        // Battery monitoring must be enabled to read a level; -1 signals "off".
        if !device.isBatteryMonitoringEnabled {
            device.isBatteryMonitoringEnabled = true
        }
        let bounds = device.screenBounds
        return [
            "batteryLevel": Double(device.batteryLevel),
            "batteryState": batteryState(device.batteryState),
            "wristLocation": device.wristLocation == .left ? "left" : "right",
            "crownOrientation": device.crownOrientation == .left ? "left" : "right",
            "screenWidth": Double(bounds.width),
            "screenHeight": Double(bounds.height),
            "screenScale": Double(device.screenScale),
            "layoutDirection": device.layoutDirection == .rightToLeft
                ? "rightToLeft" : "leftToRight",
            "model": device.model,
            "systemVersion": device.systemVersion,
            "name": device.name,
            "reduceMotion": WKAccessibilityIsReduceMotionEnabled(),
            "voiceOverRunning": WKAccessibilityIsVoiceOverRunning(),
            "preferredContentSizeCategory": device.preferredContentSizeCategory,
        ]
    }

    /// Locks the touch screen (Water Lock); the crown unlocks + ejects water.
    /// Only on a water-resistant watch — no-op/ignored otherwise.
    static func enableWaterLock() {
        WKInterfaceDevice.current().enableWaterLock()
    }

    private static func batteryState(
        _ state: WKInterfaceDeviceBatteryState
    ) -> String {
        switch state {
        case .unplugged: "unplugged"
        case .charging: "charging"
        case .full: "full"
        default: "unknown"
        }
    }
}

// MARK: - Keychain (Security framework)

enum KeychainStore {
    private static func query(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.emindeniz99.reactwatch.keychain",
            kSecAttrAccount as String: key,
        ]
    }

    @discardableResult static func set(key: String, value: String) -> Bool {
        var q = query(for: key)
        SecItemDelete(q as CFDictionary)  // replace semantics
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    static func get(key: String) -> String? {
        var q = query(for: key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
            let data = out as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(key: String) {
        SecItemDelete(query(for: key) as CFDictionary)
    }
}

// MARK: - Speech synthesis (AVSpeechSynthesizer)

final class SpeechBridge: NSObject, AVSpeechSynthesizerDelegate {
    /// (text) of the utterance that just finished or was cancelled.
    var onFinished: ((String) -> Void)?
    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(
        text: String, rate: Double?, pitch: Double?, language: String?,
        volume: Double?
    ) {
        let utterance = AVSpeechUtterance(string: text)
        if let rate { utterance.rate = Float(rate) }
        if let pitch { utterance.pitchMultiplier = Float(pitch) }
        if let volume { utterance.volume = Float(volume) }
        if let language {
            utterance.voice = AVSpeechSynthesisVoice(language: language)
        }
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
    }

    func speechSynthesizer(
        _: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
    ) {
        finish(utterance.speechString)
    }

    func speechSynthesizer(
        _: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance
    ) {
        finish(utterance.speechString)
    }

    /// The onFinished closure calls into the @MainActor model (pushNativeEvent),
    /// so hop to main — the same nonisolated(unsafe)-capture pattern SensorBridge
    /// uses for its off-main HealthKit callback (satisfies Swift 6 strict
    /// concurrency regardless of which thread the delegate fires on).
    private func finish(_ text: String) {
        nonisolated(unsafe) let handler = onFinished
        DispatchQueue.main.async { handler?(text) }
    }
}

// MARK: - Extended runtime session (WKExtendedRuntimeSession)

/// Keeps the app running for a bounded stretch. The consumer must declare a
/// runtime-session reason in Info.plist (WKBackgroundModes / the session type);
/// without it the system invalidates the session immediately, which surfaces
/// on the `runtimeSession.state` push event as `invalidated` with a reason.
final class ExtendedRuntimeBridge: NSObject, WKExtendedRuntimeSessionDelegate {
    var onState: ((_ state: String, _ reason: String?) -> Void)?
    var onWillExpire: (() -> Void)?
    private var session: WKExtendedRuntimeSession?

    func start() {
        // A session can only run once; replace any finished one.
        if session?.state == .running { return }
        let session = WKExtendedRuntimeSession()
        session.delegate = self
        session.start()
        self.session = session
    }

    func stop() {
        session?.invalidate()
        session = nil
    }

    func extendedRuntimeSessionDidStart(_: WKExtendedRuntimeSession) {
        emitState("running", nil)
    }

    func extendedRuntimeSessionWillExpire(_: WKExtendedRuntimeSession) {
        nonisolated(unsafe) let handler = onWillExpire
        DispatchQueue.main.async { handler?() }
    }

    func extendedRuntimeSession(
        _: WKExtendedRuntimeSession,
        didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason,
        error: Error?
    ) {
        emitState(
            "invalidated", error?.localizedDescription ?? "\(reason.rawValue)")
        session = nil
    }

    /// onState calls into the @MainActor model; hop to main (Swift 6 strict
    /// concurrency), matching SensorBridge's nonisolated(unsafe) convention.
    private func emitState(_ state: String, _ reason: String?) {
        nonisolated(unsafe) let handler = onState
        DispatchQueue.main.async { handler?(state, reason) }
    }
}

// MARK: - StoreKit 2

enum StoreKitBridge {
    enum Result {
        case ok(String)  // resultJson
        case error(String)
    }

    private static func json(_ object: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: object))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }

    static func products(for ids: [String]) async -> Result {
        do {
            let products = try await Product.products(for: ids)
            let payload = products.map { p -> [String: Any] in
                [
                    "id": p.id,
                    "displayName": p.displayName,
                    "description": p.description,
                    "displayPrice": p.displayPrice,
                    "price": (p.price as NSDecimalNumber).doubleValue,
                    "type": productType(p.type),
                ]
            }
            return .ok(json(payload))
        } catch {
            return .error(error.localizedDescription)
        }
    }

    static func purchase(productId: String) async -> Result {
        do {
            let products = try await Product.products(for: [productId])
            guard let product = products.first else {
                return .error("unknown product \(productId)")
            }
            let outcome = try await product.purchase()
            switch outcome {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                await transaction.finish()
                return .ok(
                    json([
                        "status": "success",
                        "productId": transaction.productID,
                        "transactionId": String(transaction.id),
                    ]))
            case .pending:
                return .ok(json(["status": "pending"]))
            case .userCancelled:
                return .ok(json(["status": "userCancelled"]))
            @unknown default:
                return .error("unknown purchase outcome")
            }
        } catch {
            return .error(error.localizedDescription)
        }
    }

    static func currentEntitlements() async -> Result {
        var ids: [String] = []
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result {
                ids.append(transaction.productID)
            }
        }
        return .ok(json(ids))
    }

    static func restore() async -> Result {
        do {
            try await AppStore.sync()
            return await currentEntitlements()
        } catch {
            return .error(error.localizedDescription)
        }
    }

    private static func checkVerified<T>(
        _ result: VerificationResult<T>
    ) throws -> T {
        switch result {
        case .verified(let safe): safe
        case .unverified(_, let error): throw error
        }
    }

    private static func productType(_ type: Product.ProductType) -> String {
        switch type {
        case .consumable: "consumable"
        case .nonConsumable: "nonConsumable"
        case .autoRenewable: "autoRenewable"
        case .nonRenewable: "nonRenewable"
        default: "nonConsumable"
        }
    }
}
#endif
