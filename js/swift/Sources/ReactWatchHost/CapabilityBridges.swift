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
            // i18n foundation (M7): QuickJS ships no Intl, so JS can't even
            // pick a translation table or a date format without the host
            // exposing the user's locale. BCP-47 identifier + bare language
            // code + the 12/24-hour preference (derived from the localized
            // time template — watchOS has no direct API for it).
            "locale": Locale.current.identifier,
            "language": Locale.current.language.languageCode?.identifier ?? "en",
            "is24Hour": is24HourClock(),
        ]
    }

    /// Whether the user's time format is 24-hour: the localized hour template
    /// for the current locale contains "H" (24h) vs "a" (am/pm marker).
    private static func is24HourClock() -> Bool {
        let format =
            DateFormatter.dateFormat(
                fromTemplate: "j", options: 0, locale: Locale.current) ?? ""
        return !format.contains("a")
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
    /// Scope keychain items to the CONSUMER's app, not a hardcoded id — every
    /// app that embeds this library gets its own keychain namespace derived from
    /// its own bundle identifier (fallback for the rare nil-bundle case).
    private static let service =
        "\(Bundle.main.bundleIdentifier ?? "reactwatch").keychain"

    private static func query(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    @discardableResult static func set(key: String, value: String) -> Bool {
        var q = query(for: key)
        SecItemDelete(q as CFDictionary)  // replace semantics
        q[kSecValueData as String] = Data(value.utf8)
        // AfterFirstUnlock (not WhenUnlocked): the framework runs code while the
        // watch is locked (background refresh, extended runtime), and those paths
        // read stored tokens. WhenUnlocked would return errSecInteractionNotAllowed
        // on a locked read, which get() can't distinguish from "absent" — silent
        // background auth failures. ThisDeviceOnly keeps the item off backups.
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
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
    /// Set by a `silent` stop() (boot() teardown) so the resulting didCancel
    /// doesn't push a stale speech.finished into a freshly booted runtime. The
    /// synthesizer is reused across generations, so its delegate can't just be
    /// detached; this one-shot flag is cleared by the next finish() instead.
    private var suppressFinish = false

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

    /// `silent` (boot() teardown) suppresses the didCancel-driven finish event
    /// for an in-flight utterance; a JS-driven stop keeps its finish semantics.
    func stop(silent: Bool = false) {
        if silent, synthesizer.isSpeaking { suppressFinish = true }
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
        if suppressFinish {
            suppressFinish = false
            return
        }
        nonisolated(unsafe) let handler = onFinished
        DispatchQueue.main.async { handler?(text) }
    }
}

// MARK: - Audio playback (AVAudioPlayer)

/// Downloads an https audio URL and plays it through an AVAudioSession
/// `.playback` (routes to Bluetooth audio, else the watch speaker). Completion
/// (natural end, not stop) is reported via onFinished.
final class AudioBridge: NSObject, AVAudioPlayerDelegate {
    var onFinished: (() -> Void)?
    private var player: AVAudioPlayer?
    private var task: URLSessionDataTask?

    /// Ceiling for a downloaded audio file. The whole file is buffered in
    /// memory before AVAudioPlayer decodes it, so an unbounded URL (a podcast
    /// episode) would jetsam the memory-tight watch app — the same reason the
    /// fetch pipeline caps bodies at 5 MiB. Audio legitimately runs larger
    /// than a fetch body (short music clips, prompts), so 10 MiB.
    private static let maxAudioBytes = 10 * 1024 * 1024

    /// (id-less) start playback; `settle` is called with nil on success or an
    /// error message. Download + decode happen off-main; playback starts on
    /// main. URLSession's completion handler is `@Sendable`, so `self` and the
    /// `settle` closure (both non-Sendable — the bridge holds mutable state, and
    /// settle re-enters the @MainActor model) are laundered with
    /// nonisolated(unsafe); everything they touch is confined to the main queue,
    /// the same discipline SpeechBridge.finish/audioPlayerDidFinishPlaying use.
    func play(
        url: URL, volume: Double?, loop: Bool,
        settle: @escaping (String?) -> Void
    ) {
        task?.cancel()
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        nonisolated(unsafe) let settle = settle
        nonisolated(unsafe) let this = self
        task = URLSession.shared.dataTask(with: request) { data, _, error in
            if let error {
                DispatchQueue.main.async { settle(error.localizedDescription) }
                return
            }
            guard let data else {
                DispatchQueue.main.async { settle("no audio data") }
                return
            }
            // Fail loud instead of decoding an unbounded buffer (see cap note).
            guard data.count <= Self.maxAudioBytes else {
                DispatchQueue.main.async {
                    settle(
                        "audio file too large: \(data.count) bytes exceeds the "
                            + "\(Self.maxAudioBytes)-byte limit")
                }
                return
            }
            DispatchQueue.main.async {
                do {
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.playback)
                    try session.setActive(true)
                    let player = try AVAudioPlayer(data: data)
                    player.delegate = this
                    if let volume { player.volume = Float(volume) }
                    player.numberOfLoops = loop ? -1 : 0
                    player.play()
                    this.player = player
                    settle(nil)
                } catch {
                    // setActive(true) may have already powered the audio route
                    // before AVAudioPlayer(data:) threw; without this the session
                    // stays active with no player until the next reload. Mirrors
                    // stop()/didFinishPlaying, which both deactivate.
                    try? AVAudioSession.sharedInstance().setActive(false)
                    settle(error.localizedDescription)
                }
            }
        }
        task?.resume()
    }

    func stop() {
        task?.cancel()
        task = nil
        player?.stop()
        player = nil
        try? AVAudioSession.sharedInstance().setActive(false)
    }

    func audioPlayerDidFinishPlaying(
        _: AVAudioPlayer, successfully _: Bool
    ) {
        player = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        nonisolated(unsafe) let handler = onFinished
        DispatchQueue.main.async { handler?() }
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
        // A session can only run once; replace any finished one. Guard on
        // "not yet invalid", not ".running": start() is asynchronous, so a
        // second start() arriving in the .notStarted window would otherwise
        // create a second session and overwrite this reference — orphaning a
        // session the system may still start, with nothing left to
        // invalidate() it (watchOS allows only one at a time).
        if let session, session.state != .invalid { return }
        let session = WKExtendedRuntimeSession()
        session.delegate = self
        session.start()
        self.session = session
    }

    /// `silent` (used by boot() teardown) detaches the delegate before
    /// invalidating so the didInvalidate callback can't push a stale
    /// `invalidated` state into a freshly booted runtime; a JS-driven stop keeps
    /// emitting the terminal state. start() always makes a new session with its
    /// own delegate, so clearing this one's is safe.
    func stop(silent: Bool = false) {
        if silent { session?.delegate = nil }
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
