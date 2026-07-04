// watchOS-only host (WatchKit/UIKit/HealthKit/SwiftUI). The #if compiles this
// file to an empty module off-watchOS so `swift test` runs on macOS — see Package.swift.
#if os(watchOS)
import CryptoKit
import ReactWatchCore
import ReactWatchRuntime
import ReactWatchSupport
import SwiftUI
import UserNotifications
import WatchKit
import WidgetKit
#if canImport(FoundationModels)
import FoundationModels
#endif

// The public watch host: a consumer's @main App embeds `ReactWatchRootView`,
// and that's the whole integration (plus shipping bundle.js as a resource).
// Everything below — runtime ownership, tree decoding, optimistic state, the
// native bridges — was the app's ReactAppModel; it now lives in the package.
//
// NOTE: SwiftUI + WatchKit/WidgetKit + the native bridges can't compile on
// Linux, so this target is the macOS gate. The engine (CQuickJS), the wire
// models (ReactWatchCore), and the embedding (ReactWatchRuntime) are all
// built and smoke-tested on Linux.

/// Loads bundle.js into QuickJS and republishes every committed React tree
/// as SwiftUI state.
@MainActor
final class ReactWatchModel: ObservableObject {
    @Published var root: RNNode?
    @Published var startupError: String?
    /// Non-fatal JS errors (event handlers, timers) surfaced as a banner.
    @Published var runtimeError: String?
    /// Set when the hard update gate refuses to boot stale JS (CR-17): the only
    /// available bundle is older than one already applied, so we show a native
    /// "update required" screen instead of running it against a newer-schema db.
    @Published var updateRequired = false
    /// Highest event seq React has acknowledged (tree.seq). Optimistic
    /// controls hold their local value until their dispatch is acked.
    @Published var ackedSeq = 0
    /// Optimistic values keyed by node id — lives on the model (not view
    /// @State) so it survives SwiftUI view identity changes mid-flight. The
    /// bookkeeping is ReactWatchSupport.OptimisticStore (unit-tested on Linux).
    @Published private var optimistic = OptimisticStore()

    /// App Group storage, configured with the consumer's group id at init —
    /// no global mutable state. nil disables widget/Storage sharing.
    private let store: SharedWidgetStore
    /// Cross-process-atomic counters (ARCH-05), same App Group as `store`.
    private let counters: CoordinatedCounterStore
    private var runtime: JSRuntime?
    private var nextSeq = 1
    /// Set once after reporting a renderer-vs-runtime wire mismatch.
    private var warnedWireMismatch = false
    /// Serial queue for decoding committed trees off the main thread.
    private let decodeQueue = DispatchQueue(label: "react.watch.decode")
    private let connectivity = PhoneConnectivity()
    private let bluetooth = BluetoothBridge()
    private let sensors = SensorBridge()
    /// Capability bridges (device/keychain/speech/runtime/background/iap),
    /// all routed through the invoke channel — see CapabilityBridges.swift.
    private let speechBridge = SpeechBridge()
    private let audioBridge = AudioBridge()
    private let extendedRuntime = ExtendedRuntimeBridge()
    private var fetchTasks: [Int: URLSessionDataTask] = [:]
    /// Bumped on every boot/reload (CX-008). Async work (fetch, generate) carries
    /// the JS-assigned id of a request whose id space resets with the runtime, so
    /// a callback from a previous generation could settle the WRONG pending
    /// request in the new one. Each async op captures the generation it started
    /// in and drops its result if it no longer matches.
    private var generation = 0

    /// The live model, so the package's WKApplicationDelegate can forward a
    /// fired background-refresh task to JS (`deliverBackgroundRefresh`). A watch
    /// app has exactly one; weak so it doesn't outlive the scene. Main-isolated.
    static weak var shared: ReactWatchModel?

    /// Whether signing is disabled / enforced / misconfigured (CX-003). The
    /// full OTA policy (trusted keys, gate, shipped version) lives inside
    /// `otaSequencer`; the host keeps only this for the fail-open warning.
    private let updateKeyState: OTAKeyState
    private let updateManifestURL: String?
    /// The OTA staging + boot orchestration (M5), extracted to Linux-tested
    /// ReactWatchSupport. The host injects the App-Group file IO, the
    /// SharedWidgetStore counters, CryptoKit verification, and throwaway
    /// JSRuntime validate/compile closures.
    private let otaSequencer: OTABootSequencer
    /// CR-5 A/B selector for the Swift→JS bridge, applied to each runtime.
    private let useJSCallBridge: Bool

    init(appGroupId: String?, ota: OTAConfig = .init(), useJSCallBridge: Bool = true) {
        store = SharedWidgetStore(appGroupId: appGroupId)
        counters = CoordinatedCounterStore(appGroupId: appGroupId)
        let keys = ota.signerPublicKeys.compactMapValues {
            Data(base64Encoded: $0)
                .flatMap { try? Curve25519.Signing.PublicKey(rawRepresentation: $0) }
        }
        // CX-003: distinguish "no keys" (fail-open) from "keys configured but all
        // malformed" (fail CLOSED) — a base64 typo must not silently disable
        // signature enforcement the developer opted into.
        let keyState = OTAKeyState.classify(
            configuredCount: ota.signerPublicKeys.count, validCount: keys.count,
            allowUnsigned: ota.allowUnsignedUpdates)
        updateKeyState = keyState
        if keys.count < ota.signerPublicKeys.count {
            print(
                "[ReactWatch] WARNING: \(ota.signerPublicKeys.count - keys.count) OTA "
                    + "signing key(s) failed to decode and were dropped (CX-003).")
        }
        updateManifestURL = ota.manifestURL
        self.useJSCallBridge = useJSCallBridge
        // Filenames come from the shared OTAFiles so the widget reads the same
        // paths; nil appGroupId disables OTA persistence (writes fail loudly).
        let otaFile: (String) -> URL? = { name in
            appGroupId.flatMap { OTAFiles.url(appGroupId: $0, name) }
        }
        otaSequencer = OTABootSequencer(
            config: .init(
                keyState: keyState, gate: ota.gate, shippedVersion: ota.shippedVersion,
                nativeBridgeProtocol: RNWire.bridgeProtocol,
                nativeFeatures: HostFeatures.watch,
                maxBundleBytes: Self.maxOTABundleBytes,
                maxBootAttempts: Self.maxOTABootAttempts),
            active: FileOTASlotStore(
                recordURL: otaFile(OTAFiles.activeRecord),
                bytecodeURL: otaFile(OTAFiles.activeBytecode)),
            knownGood: FileOTASlotStore(
                recordURL: otaFile(OTAFiles.knownGoodRecord),
                bytecodeURL: otaFile(OTAFiles.knownGoodBytecode)),
            counters: store,
            hasKey: { keys[$0] != nil },
            verify: { keyId, message, signature in
                keys[keyId]?.isValidSignature(signature, for: message) ?? false
            },
            // Same heap cap as the live runtime for both throwaway runtimes:
            // maxOTABundleBytes bounds the *source*, not allocation — an
            // unbounded validator lets a small bundle whose module init
            // allocates without limit OOM-kill the app during validation,
            // before any of the persist/rollback protections exist.
            validate: { source in
                let validator = try JSRuntime(memoryLimitBytes: 64 * 1024 * 1024)
                try validator.evaluate(source)
            },
            compile: { source in
                (try? JSRuntime(memoryLimitBytes: 64 * 1024 * 1024))?
                    .compileToBytecode(source)
            }
        )
    }

    func start() {
        guard runtime == nil else { return }
        Self.shared = self
        connectivity.onMessage = { [weak self] message in
            self?.pushNativeEvent("watchConnectivity", payload: message)
        }
        connectivity.activate()
        bluetooth.onState = { [weak self] state in
            self?.pushNativeEvent("ble.state", payload: ["state": state])
        }
        bluetooth.onNotify = { [weak self] characteristic, value, binary in
            var payload: [String: Any] = [
                "characteristic": characteristic, "value": value,
            ]
            // Only stamped for the base64 fallback, so existing text-protocol
            // consumers see an unchanged payload shape.
            if binary { payload["binary"] = true }
            self?.pushNativeEvent("ble.notify", payload: payload)
        }
        // Settle bleConnect/bleWrite/bleSubscribe invokes (CX-022). CoreBluetooth
        // delegates fire on the main queue (CBCentralManager queue: nil), so this
        // is already main-thread; a settle for a torn-down runtime hits a nil
        // runtime (or an unknown id the new runtime's pending map drops) — no-op,
        // not a mis-settle.
        bluetooth.onResolve = { [weak self] id, json in
            self?.runtime?.resolveInvoke(id: id, resultJson: json)
        }
        bluetooth.onReject = { [weak self] id, json in
            self?.runtime?.rejectInvoke(id: id, errorJson: json)
        }
        sensors.onReading = { [weak self] kind, payload in
            self?.pushNativeEvent("sensor.\(kind)", payload: payload)
        }
        speechBridge.onFinished = { [weak self] text in
            self?.pushNativeEvent("speech.finished", payload: ["text": text])
        }
        audioBridge.onFinished = { [weak self] in
            self?.pushNativeEvent("audio.finished")
        }
        extendedRuntime.onState = { [weak self] state, reason in
            var payload: [String: Any] = ["state": state]
            if let reason { payload["reason"] = reason }
            self?.pushNativeEvent("runtimeSession.state", payload: payload)
        }
        extendedRuntime.onWillExpire = { [weak self] in
            self?.pushNativeEvent("runtimeSession.willExpire")
        }
        boot()
        #if DEBUG
        startDevReload()
        #endif
    }

    /// Boots a fresh runtime, preferring precompiled bytecode (bundle.qbc)
    /// and falling back to parsing bundle.js.
    private func boot(devCode: String? = nil) {
        // Tear down the previous generation's in-flight async before the id space
        // resets (CX-008): cancel outstanding fetches and stop sensor streams so
        // their callbacks can't settle against — or push stale readings into —
        // the fresh runtime. The BLE *connection* is intentionally left up (a
        // stateful link we don't want to drop on a dev hot-reload, and its
        // state/notify events are name-routed), but its connect/write/subscribe
        // invoke correlation is id-keyed (CX-022) and ids reset per runtime, so
        // drop the pending correlation or a late delegate could settle a NEW
        // promise that happens to reuse an old id.
        generation += 1
        for task in fetchTasks.values {
            task.cancel()
        }
        fetchTasks.removeAll()
        sensors.stopAll()
        bluetooth.resetPendingForReload()
        // Stop native media/session resources tied to the outgoing generation so
        // they can't drain battery or push stale finish/state events into the
        // fresh runtime (audio download+player+session, in-flight speech, and the
        // extended-runtime session). `silent:` suppresses the teardown-only
        // lifecycle event for the two that emit one on cancel/invalidate.
        audioBridge.stop()
        speechBridge.stop(silent: true)
        extendedRuntime.stop(silent: true)
        runtime = nil
        root = nil
        runtimeError = nil
        startupError = nil
        updateRequired = false
        ackedSeq = 0
        nextSeq = 1
        optimistic = OptimisticStore()
        // One warning per BOOT, not per model lifetime (NF-15): without the
        // reset, a second bad bundle after a dev hot-reload would be rejected
        // with no banner at all.
        warnedWireMismatch = false
        // Only the .runOTA branches repopulate this; without the reset a later
        // .runShipped or DEBUG dev-code boot retains the previous OTA record,
        // and the first-healthy-commit handler could promote a bundle that is
        // not the one actually running to known-good.
        bootedOTARecord = nil
        do {
            let js = try makeRuntime()
            runtime = js
            installHostCapabilities(js)
            #if DEBUG
            try? js.evaluate(
                "globalThis.__inspectorUrl='http://127.0.0.1:8099/snapshot'"
            )
            #endif
            if let devCode {
                try js.evaluate(devCode)
            } else {
                try load(into: js)
            }
        } catch {
            startupError = "JS startup failed: \(error)"
        }
    }

    /// Exposes this binary's capability set + bridge protocol to JS before the
    /// bundle runs (ARCH-01), so the JS OTA gate (update.ts) can refuse — before
    /// downloading — a bundle needing a feature this app doesn't provide.
    private func installHostCapabilities(_ js: JSRuntime) {
        let features = Array(HostFeatures.watch).sorted()
        let json =
            (try? JSONSerialization.data(withJSONObject: features))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        try? js.evaluate(
            "globalThis.__hostFeatures=\(json);"
                + "globalThis.__bridgeProtocol=\(RNWire.bridgeProtocol);",
            filename: "host-capabilities.js"
        )
    }

    /// The OTA record this launch actually booted (nil = running shipped). Set in
    /// `load`; read in the first-healthy-commit handler to promote it to the
    /// known-good snapshot.
    private var bootedOTARecord: OTARecord?

    /// Ceiling for an OTA bundle. The app parses the whole source through
    /// QuickJS at launch, so a multi-MB bundle risks an out-of-memory kill on a
    /// memory-tight watch (the atomic write also needs ~2x transiently). Reject
    /// past this rather than persist something that can't load.
    private static let maxOTABundleBytes = 3 * 1024 * 1024

    /// Routes a generic invoke (SD-1) to its handler; an unknown method rejects
    /// (never hangs the JS Promise).
    private func handleInvoke(id: Int, method: String, payload: String) {
        switch method {
        case "saveUpdate":
            handleSaveUpdate(id: id, payload: payload)
        case "requestNotificationPermission":
            requestNotificationPermission(id: id)
        case "sendToPhone":
            sendToPhone(id: id, payload: payload)
        case "scheduleNotification":
            scheduleNotification(id: id, payload: payload)
        case "aiAvailability":
            aiAvailability(id: id)
        case "bleConnect":
            bluetooth.handleInvoke(id: id, method: method, payload: payload)
        case "bleWrite":
            bluetooth.handleInvoke(id: id, method: method, payload: payload)
        case "bleSubscribe":
            bluetooth.handleInvoke(id: id, method: method, payload: payload)
        case "getDeviceInfo":
            handleGetDeviceInfo(id: id)
        case "enableWaterLock":
            DeviceSnapshot.enableWaterLock()
            runtime?.resolveInvoke(id: id, resultJson: "null")
        case "scheduleBackgroundRefresh":
            handleScheduleBackgroundRefresh(id: id, payload: payload)
        case "startExtendedRuntimeSession":
            handleStartExtendedRuntimeSession(id: id)
        case "stopExtendedRuntimeSession":
            handleStopExtendedRuntimeSession(id: id)
        case "keychainSet":
            handleKeychainSet(id: id, payload: payload)
        case "keychainGet":
            handleKeychainGet(id: id, payload: payload)
        case "keychainDelete":
            handleKeychainDelete(id: id, payload: payload)
        case "speak":
            handleSpeak(id: id, payload: payload)
        case "stopSpeaking":
            handleStopSpeaking(id: id)
        case "playAudio":
            handlePlayAudio(id: id, payload: payload)
        case "stopAudio":
            handleStopAudio(id: id)
        case "getProducts":
            handleGetProducts(id: id, payload: payload)
        case "purchase":
            handlePurchase(id: id, payload: payload)
        case "currentEntitlements":
            handleCurrentEntitlements(id: id)
        case "restorePurchases":
            handleRestorePurchases(id: id)
        default:
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(
                    code: "UNKNOWN_METHOD", message: "no invoke handler for \(method)"))
        }
    }

    /// Runs the staging pipeline and *resolves* the invoke with a
    /// SaveUpdateResult (CX-005): a refusal (bad signature, capability gap,
    /// downgrade, write failure) is a normal `{accepted:false}` result — not an
    /// invoke rejection — so the reason reaches applyUpdate instead of
    /// vanishing. Staging (validator eval + bytecode compile) runs OFF the main
    /// thread (M5); the settle hops back to main, generation-guarded (CX-008).
    private func handleSaveUpdate(id: Int, payload: String) {
        let gen = generation
        Task { [weak self] in
            guard let self else { return }
            let outcome = await self.stageUpdate(payload)
            guard gen == self.generation else { return }
            switch outcome {
            case .accepted:
                self.runtime?.resolveInvoke(id: id, resultJson: #"{"accepted":true}"#)
            case .rejected(let reason):
                self.runtimeError = reason
                let result: [String: Any] = [
                    "accepted": false, "code": "rejected", "message": reason,
                ]
                self.runtime?.resolveInvoke(id: id, resultJson: Self.jsonObject(result))
            }
        }
    }

    /// Stages an OTA payload through the sequencer on a background executor —
    /// the validator eval and bytecode compile are the two heavyweight steps
    /// that used to run synchronously on main (M5). The sequencer is Sendable
    /// (App-Group file IO + UserDefaults counters + throwaway runtimes), so the
    /// detached hop is safe.
    private func stageUpdate(_ payload: String) async -> StageOutcome {
        if updateKeyState == .disabled {
            print(
                "[ReactWatch] WARNING: persisting OTA bundle WITHOUT signature "
                    + "verification — set OTAConfig.signerPublicKeys to enforce (CR-4).")
        }
        let sequencer = otaSequencer
        return await Task.detached(priority: .utility) { sequencer.stage(payload) }.value
    }

    /// Requests notification permission and resolves the invoke with the real
    /// authorization status (CX-022) — resolved from getNotificationSettings, not
    /// the granted Bool (`.provisional` silently returns true). A native error
    /// rejects. Generation-guarded (CX-008).
    private func requestNotificationPermission(id: Int) {
        let gen = generation
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] _, error in
            if let error {
                DispatchQueue.main.async {
                    guard let self, gen == self.generation else { return }
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: "INTERNAL", message: error.localizedDescription))
                }
                return
            }
            center.getNotificationSettings { settings in
                let status = Self.permissionStatus(settings.authorizationStatus)
                DispatchQueue.main.async {
                    guard let self, gen == self.generation else { return }
                    self.runtime?.resolveInvoke(
                        id: id, resultJson: Self.jsonString(status))
                }
            }
        }
    }

    /// Sends a message to the paired iPhone and resolves the invoke with its
    /// reply, or rejects when unreachable / on a WCError (CX-022). The WCSession
    /// handlers fire on a background queue, so hop to main + generation-guard
    /// (CX-008) before settling.
    private func sendToPhone(id: Int, payload: String) {
        let gen = generation
        connectivity.send(payload) { [weak self] result in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                switch result {
                case .success(let replyJson):
                    self.runtime?.resolveInvoke(id: id, resultJson: replyJson)
                case .failure(let error):
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: error.code, message: error.message))
                }
            }
        }
    }

    /// Maps UNAuthorizationStatus to the JS NotificationPermission string
    /// (js/src/notifications.ts). `.ephemeral` (App Clips, not watch) is treated
    /// as granted; anything unknown is reported as unavailable.
    private static func permissionStatus(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized: "granted"
        case .denied: "denied"
        case .notDetermined: "notDetermined"
        case .provisional: "provisional"
        case .ephemeral: "granted"
        @unknown default: "unavailable"
        }
    }

    /// JSON-encodes a {code, message} reject payload, escaping safely — the
    /// shared builder so every bridge produces identical, always-valid JSON.
    private static func errorJSON(code: String, message: String) -> String {
        InvokeErrorJSON.make(code: code, message: message)
    }

    /// JSON-encodes an object for an invoke result/error, escaping safely.
    private static func jsonObject(_ object: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: object))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    /// JSON-encodes a bare string as an invoke result (e.g. a status enum).
    private static func jsonString(_ value: String) -> String {
        (try? JSONSerialization.data(
            withJSONObject: value, options: .fragmentsAllowed
        ))
        .flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    }

    /// Remote manifest served at `OTAConfig.manifestURL` ({version, bundle,
    /// signature}); `bundle` is absolute or relative to the manifest URL.
    private struct RemoteManifest: Decodable {
        let version: Int
        let bundle: String
        let signature: String?
        let keyId: String?
    }

    /// Native OTA recovery for the hard gate (CR-17): when stale JS is blocked
    /// the JS app isn't running to fetch an update, so fetch the manifest +
    /// bundle natively, stage it through the same verified `saveUpdate` gate,
    /// and reboot to apply. Used by `UpdateRequiredView`'s button.
    func checkForUpdateNatively() async {
        guard let urlString = updateManifestURL, let url = URL(string: urlString) else {
            runtimeError = "no update URL configured"
            return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let manifest = try JSONDecoder().decode(RemoteManifest.self, from: data)
            guard let bundleURL = URL(string: manifest.bundle, relativeTo: url) else {
                runtimeError = "update manifest has no bundle URL"
                return
            }
            let (jsData, _) = try await URLSession.shared.data(from: bundleURL)
            // Enforce the size cap BEFORE materializing a String — saveUpdate
            // checks it too, but only after this path has already doubled the
            // allocation for a hostile/erroneous manifest's bundle (NF-33).
            guard jsData.count <= Self.maxOTABundleBytes else {
                runtimeError =
                    "update bundle is \(jsData.count) bytes — over the "
                    + "\(Self.maxOTABundleBytes)-byte limit"
                return
            }
            guard let js = String(data: jsData, encoding: .utf8) else {
                runtimeError = "update bundle was not UTF-8 text"
                return
            }
            var payload: [String: Any] = ["js": js, "version": manifest.version]
            if let signature = manifest.signature { payload["signature"] = signature }
            if let keyId = manifest.keyId { payload["keyId"] = keyId }
            guard let payloadData = try? JSONSerialization.data(withJSONObject: payload),
                let payloadString = String(data: payloadData, encoding: .utf8)
            else { return }
            if case .rejected(let reason) = await stageUpdate(payloadString) {
                runtimeError = reason
                return
            }
            boot()  // re-load; the staged bundle (>= high-water) now runs
        } catch {
            runtimeError = "update check failed: \(error.localizedDescription)"
        }
    }

    private struct GenerateRequest: Decodable {
        let prompt: String
        let instructions: String?
        let temperature: Double?
        /// Optional cap on the model's response length (GenerationOptions
        /// .maximumResponseTokens), from js/src/ai.ts GenerateOptions.maxTokens.
        let maxTokens: Int?
    }

    /// Resolves the invoke with whether on-device AI can run now (CX-002):
    /// `SystemLanguageModel.default.isAvailable` on watchOS 27+, else `false`.
    /// On an older SDK FoundationModels isn't in the watch SDK, so this compiles
    /// to the `false` fallthrough — building the real query needs Xcode 27.
    private func aiAvailability(id: Int) {
        #if canImport(FoundationModels)
        if #available(watchOS 27.0, *) {
            let available = SystemLanguageModel.default.isAvailable
            runtime?.resolveInvoke(id: id, resultJson: available ? "true" : "false")
            return
        }
        #endif
        runtime?.resolveInvoke(id: id, resultJson: "false")
    }

    /// On-device text generation via Foundation Models (js/src/ai.ts).
    private func generate(id: Int, requestJson: String) {
        guard
            let req = try? JSONDecoder().decode(
                GenerateRequest.self, from: Data(requestJson.utf8)
            )
        else {
            runtime?.rejectGenerate(id: id, message: "bad request")
            return
        }
        #if canImport(FoundationModels)
        // Foundation Models' LanguageModelSession is watchOS 27.0+ (Apple docs;
        // it's 26.0 on iOS/macOS but only reached the watch at 27.0, in beta) —
        // the gate was wrongly 26.0 (CX-002). Building this path needs the
        // watchOS 27 SDK (Xcode 27); on an older SDK FoundationModels isn't in
        // the watch SDK, so this whole block compiles out and generate() rejects
        // below with "on-device AI unavailable".
        if #available(watchOS 27.0, *) {
            let gen = generation
            Task { [weak self] in
                do {
                    let session = LanguageModelSession(
                        instructions: req.instructions ?? ""
                    )
                    var options = GenerationOptions()
                    if let t = req.temperature { options.temperature = t }
                    if let max = req.maxTokens { options.maximumResponseTokens = max }
                    let response = try await session.respond(
                        to: req.prompt, options: options
                    )
                    await MainActor.run {
                        guard let self, gen == self.generation else { return }
                        self.runtime?.resolveGenerate(id: id, text: response.content)
                    }
                } catch {
                    await MainActor.run {
                        guard let self, gen == self.generation else { return }
                        self.runtime?.rejectGenerate(
                            id: id, message: error.localizedDescription
                        )
                    }
                }
            }
            return
        }
        #endif
        runtime?.rejectGenerate(id: id, message: "on-device AI unavailable")
    }

    /// How many times the OTA bundle may boot without reaching a healthy commit
    /// before it's rolled back to shipped (ARCH-04 crash-loop guard).
    private static let maxOTABootAttempts = 3

    /// Delegates the boot decision + fallback chain (anti-rollback, crash-loop
    /// recovery, bytecode trust, high-water bumps) to the Linux-tested
    /// sequencer (M5); this shell just binds the eval closures to the live
    /// runtime and maps the outcome onto the published UI state.
    private func load(into js: JSRuntime) throws {
        let outcome = try otaSequencer.boot(
            evalSource: { source in
                Self.setBundleReleaseId(source, into: js)
                try js.evaluate(source)
            },
            evalBytecode: { bytecode, source in
                Self.setBundleReleaseId(source, into: js)
                try js.evaluateBytecode(bytecode)
            },
            evalShipped: { try self.loadShipped(into: js) }
        )
        switch outcome {
        case .ranOTA(let record, let notice):
            bootedOTARecord = record
            if let notice { runtimeError = notice }
        case .ranShipped(let notice):
            if let notice { runtimeError = notice }
        case .blockForUpdate(let notice):
            // Hard gate: every available bundle is older than one already
            // applied — refuse to boot stale JS so it can't write to a
            // newer-schema db; show the native "update required" screen.
            if let notice { runtimeError = notice }
            updateRequired = true
        }
    }

    /// Exposes the loaded bundle's content id to JS (CX-025) so `checkForUpdate`
    /// can compare it to the server manifest's `releaseId` and detect a
    /// non-breaking fix that kept the same `version`. The id is FNV-1a hex
    /// (matching the build's `contentHash`), set BEFORE the bundle runs.
    private static func setBundleReleaseId(_ source: String, into js: JSRuntime) {
        try? js.evaluate(
            "globalThis.__bundleReleaseId='\(ContentHash.of(source))';",
            filename: "release-id.js")
    }

    private func loadShipped(into js: JSRuntime) throws {
        // Read the source up front for the release id (CX-025), even when the
        // precompiled bytecode runs below — so JS always learns its content id.
        let source = Bundle.main.url(forResource: "bundle", withExtension: "js")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
        if let source { Self.setBundleReleaseId(source, into: js) }

        if let qbc = Bundle.main.url(forResource: "bundle", withExtension: "qbc"),
            let data = try? Data(contentsOf: qbc)
        {
            do {
                try js.evaluateBytecode(data)
                return
            } catch {
                runtimeError = "bytecode load failed, using bundle.js: \(error)"
            }
        }
        guard let code = source else {
            throw JSRuntime.JSError.exception("bundle.js missing — run `npm run build`")
        }
        try js.evaluate(code)
    }

    private func makeRuntime() throws -> JSRuntime {
        // Cap the app's QuickJS heap so a runaway/oversized bundle fails loudly
        // inside the engine instead of getting the whole app OOM-jetsammed
        // (OP-3). Generous vs the widget's 16MB — the app has the full UI tree.
        let js = try JSRuntime(memoryLimitBytes: 64 * 1024 * 1024)
        js.useJSCallBridge = useJSCallBridge  // CR-5 A/B selector
        js.bridge.commit = { [weak self] json in
            guard let self else { return }
            // Capture the generation this commit was emitted under: the tree is
            // decoded on a background queue, and a reload meanwhile would swap the
            // runtime. Without this guard the stale tree would clobber the new
            // runtime's root and advance its ack (CX-008) — the one async settle
            // that was missing the guard every other one has.
            let gen = self.generation
            self.decodeQueue.async { [weak self] in
                let decoded = try? JSONDecoder().decode(
                    RNTree.self, from: Data(json.utf8)
                )
                DispatchQueue.main.async { [weak self] in
                    guard let self, gen == self.generation else { return }
                    guard let tree = decoded else {
                        self.runtimeError = "tree decode failed"
                        return
                    }
                    // The JS bundle and this native target version evolve
                    // independently; a wire-version mismatch means the tree may
                    // mis-decode. Surface it loudly (once) and REJECT the commit
                    // — don't let an incompatible tree reach the interpreter or
                    // advance the optimistic ack (CX-009).
                    if tree.v != RNWire.version {
                        if !self.warnedWireMismatch {
                            self.warnedWireMismatch = true
                            self.runtimeError =
                                "wire version mismatch: bundle v\(tree.v) vs "
                                + "runtime v\(RNWire.version) — rebuild the bundle"
                        }
                        return
                    }
                    // @Published fires objectWillChange on every assignment
                    // regardless of equality; guard so an ack-only or
                    // value-identical commit (high-frequency sensor pushes)
                    // doesn't re-diff the whole SwiftUI tree (NF-22).
                    if self.root != tree.root {
                        self.root = tree.root
                    }
                    // A committed tree means the bundle booted healthily — clear
                    // the crash-loop counter so only *boot* failures accumulate
                    // (ARCH-04), and snapshot the running OTA bundle as the
                    // known-good rollback target (no-op when running shipped, or
                    // when the snapshot already matches).
                    self.otaSequencer.markHealthy(bootedRecord: self.bootedOTARecord)
                    if tree.seq > self.ackedSeq {
                        self.ackedSeq = tree.seq
                        self.optimistic.ack(throughSeq: tree.seq)
                    }
                }
            }
        }
        js.bridge.publishWidgets = { [store] json in
            store.save(json)
            WidgetCenter.shared.reloadAllTimelines()
        }
        js.bridge.getItem = { [store] in store.getItem($0) }
        js.bridge.setItem = { [store] in store.setItem($0, $1) }
        js.bridge.counterGet = { [counters] in counters.value(forKey: $0) }
        js.bridge.counterAdd = { [counters] key, delta, min, max in
            counters.add(delta, toKey: key, min: min, max: max)
        }
        js.bridge.fetch = { [weak self] id, reqJson in
            self?.performFetch(id: id, requestJson: reqJson)
        }
        js.bridge.abortFetch = { [weak self] id in self?.abortFetch(id: id) }
        js.bridge.ble = { [weak self] json in self?.bluetooth.handleOp(json) }
        js.bridge.sensor = { [weak self] json in self?.sensors.handleOp(json) }
        js.bridge.invoke = { [weak self] id, method, payload in
            self?.handleInvoke(id: id, method: method, payload: payload)
        }
        js.bridge.generate = { [weak self] id, reqJson in
            self?.generate(id: id, requestJson: reqJson)
        }
        // Capture the generation NOW (makeRuntime runs under the boot that
        // just bumped it): reading it when the error fires would see the new
        // generation after a swap and defeat the guard (CX-008 / NF-14).
        let gen = generation
        js.onError = { [weak self] message in
            DispatchQueue.main.async { [weak self] in
                guard let self, gen == self.generation else { return }
                self.runtimeError = message
            }
        }
        js.bridge.playHaptic = { type in
            let haptic: WKHapticType =
                switch type {
                case "success": .success
                case "failure": .failure
                case "notification": .notification
                case "directionUp": .directionUp
                case "directionDown": .directionDown
                case "start": .start
                case "stop": .stop
                case "retry": .retry
                default: .click
                }
            WKInterfaceDevice.current().play(haptic)
        }
        js.bridge.cancelNotification = { id in
            UNUserNotificationCenter.current()
                .removePendingNotificationRequests(withIdentifiers: [id])
        }
        return js
    }

    /// Schedules a local notification and settles the invoke (CX-022): a native
    /// `UNUserNotificationCenter.add` failure rejects so it reaches JS instead of
    /// vanishing; success resolves. Decode + trigger-time math is
    /// ReactWatchSupport.NotificationPlan (unit-tested on Linux); the host just
    /// builds the request. The add callback fires on a background queue, so hop
    /// to main + generation-guard (CX-008) before settling.
    private func scheduleNotification(id: Int, payload: String) {
        guard let plan = NotificationPlan(json: payload) else {
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(
                    code: "INVALID_REQUEST", message: "bad notification payload"))
            return
        }
        let content = UNMutableNotificationContent()
        content.title = plan.title
        content.body = plan.body
        if plan.sound { content.sound = .default }
        let request = UNNotificationRequest(
            identifier: plan.id,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(
                timeInterval: plan.triggerSeconds, repeats: false
            )
        )
        let gen = generation
        UNUserNotificationCenter.current().add(request) { [weak self] error in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                if let error {
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: "INTERNAL", message: error.localizedDescription))
                } else {
                    self.runtime?.resolveInvoke(id: id, resultJson: "null")
                }
            }
        }
    }

    /// Returns the seq assigned to this dispatch; optimistic controls
    /// compare it against ackedSeq to know when React has caught up.
    @discardableResult
    func dispatch(nodeId: Int, event: String, payload: [String: Any]? = nil) -> Int {
        let seq = nextSeq
        nextSeq += 1
        runtime?.dispatchEvent(
            nodeId: nodeId, event: event, payload: payload, seq: seq
        )
        return seq
    }

    /// Forwards a native state push (connectivity, lifecycle, sensors) into
    /// React at urgent priority — commits instantly, like a tap.
    func pushNativeEvent(_ name: String, payload: [String: Any]? = nil) {
        runtime?.pushNativeEvent(name, payload: payload)
    }

    /// Runs a JS fetch over URLSession; settles the Promise back on main.
    /// Request parsing + response assembly are ReactWatchSupport (FetchPlan /
    /// FetchResponse), tested on Linux; the host only orchestrates URLSession.
    private func performFetch(id: Int, requestJson: String) {
        guard let plan = FetchPlan(json: requestJson) else {
            runtime?.rejectFetch(id: id, message: "invalid fetch request")
            return
        }
        let gen = generation
        let task = URLSession.shared
            .dataTask(with: plan.request) { [weak self] data, response, error in
                DispatchQueue.main.async {
                    guard let self, gen == self.generation else { return }
                    self.fetchTasks[id] = nil
                    if let error {
                        if (error as NSError).code != NSURLErrorCancelled {
                            self.runtime?.rejectFetch(
                                id: id, message: error.localizedDescription
                            )
                        }
                        return
                    }
                    let http = response as? HTTPURLResponse
                    var headers: [String: String] = [:]
                    http?.allHeaderFields.forEach { key, value in
                        // Repeated headers (e.g. Set-Cookie) arrive as an array;
                        // WHATWG joins them with ", ", not Swift's "[a, b]"
                        // array description.
                        let joined =
                            (value as? [Any]).map { array in
                                array.map { "\($0)" }.joined(separator: ", ")
                            } ?? "\(value)"
                        headers["\(key)".lowercased()] = joined
                    }
                    let status = http?.statusCode ?? 0
                    let url = http?.url?.absoluteString ?? plan.url
                    switch FetchResponse.classifyBody(data) {
                    case .tooLarge(let bytes, let limit):
                        // Don't bridge an unbounded body into the watch's tight
                        // QuickJS heap — fail loud instead of risking OOM.
                        self.runtime?.rejectFetch(
                            id: id,
                            message: "response body too large: \(bytes) bytes "
                                + "exceeds \(limit)-byte limit"
                        )
                    case .text(let text):
                        self.runtime?.resolveFetch(
                            id: id,
                            responseJson: FetchResponse.json(
                                status: status, url: url, body: text,
                                headers: headers
                            )
                        )
                    case .base64(let encoded):
                        // Binary body — carried as base64 so it isn't silently
                        // dropped (the old UTF-8 decode turned it into "").
                        self.runtime?.resolveFetch(
                            id: id,
                            responseJson: FetchResponse.json(
                                status: status, url: url, body: encoded,
                                headers: headers, bodyEncoding: "base64"
                            )
                        )
                    }
                }
            }
        fetchTasks[id] = task
        task.resume()
    }

    private func abortFetch(id: Int) {
        fetchTasks[id]?.cancel()
        fetchTasks[id] = nil
    }

    /// Dispatches an event and remembers `value` as the node's optimistic
    /// value until React acks this dispatch — the release is the guaranteed
    /// seq-ack, so a handler that DECLINES the change (keeps its state) still
    /// snaps native back instead of leaving it diverged.
    func dispatchOptimistic(
        nodeId: Int, value: JSONValue, payload: [String: Any],
        event: String = "change"
    ) {
        let seq = dispatch(nodeId: nodeId, event: event, payload: payload)
        optimistic.set(nodeId: nodeId, seq: seq, value: value)
    }

    func optimisticBool(_ nodeId: Int) -> Bool? {
        optimistic.bool(nodeId)
    }

    func optimisticInt(_ nodeId: Int) -> Int? {
        optimistic.int(nodeId)
    }

    func optimisticDouble(_ nodeId: Int) -> Double? {
        optimistic.double(nodeId)
    }

    func optimisticString(_ nodeId: Int) -> String? {
        optimistic.string(nodeId)
    }

    func optimisticStringArray(_ nodeId: Int) -> [String]? {
        optimistic.stringArray(nodeId)
    }

    #if DEBUG
    /// The dev-server bundle URL a DEBUG build polls (the `react-watchos dev`
    /// contract). Overridable via the `ReactWatchDevServerURL` Info.plist key
    /// (M11) — a physical watch needs the Mac's LAN IP, not localhost.
    private static let devBundleURL: URL = {
        if let s = Bundle.main.object(
            forInfoDictionaryKey: "ReactWatchDevServerURL") as? String,
            let url = URL(string: s)
        {
            return url
        }
        return URL(string: "http://127.0.0.1:8788/bundle.js")!
    }()
    private var devTask: Task<Void, Never>?
    private var lastDevBundle: String?

    private func startDevReload() {
        guard devTask == nil else { return }
        devTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                await self?.pollDevServer()
            }
        }
    }

    private func pollDevServer() async {
        var request = URLRequest(url: Self.devBundleURL)
        request.timeoutInterval = 1.5
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, _) = try? await URLSession.shared.data(for: request),
            let code = String(data: data, encoding: .utf8),
            !code.isEmpty, code != lastDevBundle
        else { return }
        let isFirstFetch = lastDevBundle == nil
        lastDevBundle = code
        if !isFirstFetch {
            boot(devCode: code)
        }
    }
    #endif
}

/// OTA verification + rollback policy for `ReactWatchRootView` (CR-4 / CR-17).
public struct OTAConfig: Sendable {
    /// Trusted OTA signing keys (CX-007): `keyId -> base64 Ed25519 public key`.
    /// Empty = OTA saves are REFUSED unless `allowUnsignedUpdates` is set
    /// (NF-29 secure default); set keys to enforce signed updates +
    /// anti-rollback. Multiple entries enable key rotation — trust `{old, new}`
    /// while you migrate signing to `new`, then
    /// drop `old` in a later app release (rotate-then-revoke with an overlap
    /// window so no device is stranded). This map ships INSIDE the code-signed
    /// app binary: it's the trust anchor, so it must never come from a source
    /// the OTA channel could mutate.
    public var signerPublicKeys: [String: String]
    /// `.hard` refuses to boot a bundle older than the newest applied (protects
    /// the db from stale JS); `.soft` runs it and lets the app prompt to update.
    public var gate: OTAGate
    /// Compatibility version of the bundle shipped in the app binary. Bump it in
    /// lockstep with the shipped bundle, only on a breaking change (db schema /
    /// wire contract); it anchors the anti-rollback boot decision.
    public var shippedVersion: Int
    /// Update manifest endpoint (`{version, bundle, signature}`). Lets the hard
    /// gate's "Check for update" recover natively — re-fetching a current bundle
    /// when stale JS is blocked and the JS app isn't running to fetch. HTTPS.
    public var manifestURL: String?
    /// Explicit dev opt-in to load UNSIGNED OTA bundles when no keys are
    /// configured (NF-29). Never ship a release build with this set: anyone
    /// who can answer the manifest URL gets the full host surface. Ignored
    /// once `signerPublicKeys` is non-empty — keys always enforce.
    public var allowUnsignedUpdates: Bool

    public init(
        signerPublicKeys: [String: String] = [:], gate: OTAGate = .soft,
        shippedVersion: Int = 1, manifestURL: String? = nil,
        allowUnsignedUpdates: Bool = false
    ) {
        self.signerPublicKeys = signerPublicKeys
        self.gate = gate
        self.shippedVersion = shippedVersion
        self.manifestURL = manifestURL
        self.allowUnsignedUpdates = allowUnsignedUpdates
    }
}

/// Shown by the hard update gate (CR-17) when stale JS is refused, so it never
/// runs against a newer-schema db. Native, because the JS app isn't booted in
/// this state; recovery (re-fetching a current bundle) is wired separately.
private struct UpdateRequiredView: View {
    @EnvironmentObject private var model: ReactWatchModel

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Image(systemName: "arrow.down.circle").font(.title2)
                Text("Update required").font(.headline)
                Text("A newer version is needed to run safely.")
                    .font(.footnote).multilineTextAlignment(.center)
                Button("Check for update") {
                    Task { await model.checkForUpdateNatively() }
                }
                if let error = model.runtimeError {
                    Text(error).font(.caption2).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding()
        }
    }
}

/// The watch UI. Embed this in your @main App's scene; ship bundle.js as a
/// resource. `appGroupId` enables shared widget/Storage state (optional); `ota`
/// configures signed-update verification + anti-rollback (CR-4 / CR-17).
/// `useJSCallBridge` selects the Swift→JS bridge (CR-5): the default `JS_Call`
/// path or, set to `false`, the legacy eval path — set it per launch (e.g. a
/// random bucket) to A/B them on-device before the eval path is retired.
public struct ReactWatchRootView: View {
    @StateObject private var model: ReactWatchModel
    @Environment(\.scenePhase) private var scenePhase

    public init(
        appGroupId: String? = nil, ota: OTAConfig = .init(),
        useJSCallBridge: Bool = true
    ) {
        _model = StateObject(
            wrappedValue: ReactWatchModel(
                appGroupId: appGroupId, ota: ota, useJSCallBridge: useJSCallBridge
            ))
    }

    public var body: some View {
        Group {
            if model.updateRequired {
                UpdateRequiredView()
            } else if let root = model.root {
                // Screens own their scrolling (ScrollView/List nodes).
                NodeView(node: root)
            } else if let error = model.startupError {
                ScrollView {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            } else {
                ProgressView()
            }
        }
        .overlay(alignment: .bottom) {
            if let error = model.runtimeError {
                ScrollView {
                    Text(error)
                        .font(.footnote.monospaced())
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(6)
                }
                .frame(maxHeight: 120)
                .background(.red.opacity(0.85), in: .rect(cornerRadius: 8))
                .onTapGesture { model.runtimeError = nil }
            }
        }
        .environmentObject(model)
        .onAppear { model.start() }
        .onChange(of: scenePhase) { _, phase in
            model.pushNativeEvent("scenePhase", payload: ["phase": "\(phase)"])
        }
        .onOpenURL { url in
            model.pushNativeEvent("openURL", payload: ["url": url.absoluteString])
        }
    }
}

/// The package's WKApplicationDelegate: forwards a fired background-refresh
/// task to JS (`onBackgroundRefresh`). Wire it in your @main App with
/// `@WKApplicationDelegateAdaptor(ReactWatchAppDelegate.self)` — the
/// `react-watchos scaffold` command writes this for you. Without it,
/// `scheduleBackgroundRefresh` still schedules the wake, but the fire event
/// never reaches JS (a scenePhase `active` wake does).
public final class ReactWatchAppDelegate: NSObject, WKApplicationDelegate {
    public override init() { super.init() }

    public func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        // WatchKit delivers background tasks on the main thread; deliver to JS
        // SYNCHRONOUSLY (a pushNativeEvent commit), THEN complete the task, so
        // watchOS doesn't suspend mid-commit.
        for task in backgroundTasks {
            if let refresh = task as? WKApplicationRefreshBackgroundTask {
                let userInfo = Self.decodeUserInfo(refresh.userInfo)
                MainActor.assumeIsolated {
                    ReactWatchModel.shared?.deliverBackgroundRefresh(userInfo: userInfo)
                }
            }
            // No snapshot: we changed no UI directly (JS republishes widgets).
            task.setTaskCompletedWithSnapshot(false)
        }
    }

    /// The userInfo we scheduled with is carried as a JSON NSString (see
    /// handleScheduleBackgroundRefresh); decode it back to a dictionary.
    private static func decodeUserInfo(_ raw: NSSecureCoding?) -> [String: Any]? {
        guard let json = raw as? NSString,
            let data = (json as String).data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj
    }
}

// MARK: - Capability invoke handlers (device/background/runtime/keychain/
// speech/iap). Same-file extension so the generation guard (private) is
// visible; the native bits live in CapabilityBridges.swift.
extension ReactWatchModel {
    func handleGetDeviceInfo(id: Int) {
        runtime?.resolveInvoke(
            id: id, resultJson: Self.jsonObject(DeviceSnapshot.current()))
    }

    func handleScheduleBackgroundRefresh(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        let afterMs = (fields["afterMs"] as? Double) ?? 0
        let date = Date().addingTimeInterval(max(0, afterMs) / 1000)
        // userInfo must be (NSSecureCoding & NSObjectProtocol)?: carry the JSON
        // userInfo as an NSString so it round-trips to the fire event verbatim.
        var info: (NSSecureCoding & NSObjectProtocol)?
        if let userInfo = fields["userInfo"],
            let data = try? JSONSerialization.data(withJSONObject: userInfo),
            let json = String(data: data, encoding: .utf8)
        {
            info = json as NSString
        }
        let gen = generation
        WKApplication.shared().scheduleBackgroundRefresh(
            withPreferredDate: date, userInfo: info
        ) { [weak self] error in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                if let error {
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: "INTERNAL", message: error.localizedDescription))
                } else {
                    self.runtime?.resolveInvoke(id: id, resultJson: "null")
                }
            }
        }
    }

    /// Delivery hook for a fired background refresh -> JS `onBackgroundRefresh`.
    /// Called by ReactWatchAppDelegate.handle(_:) when watchOS runs a task
    /// scheduled by `scheduleBackgroundRefresh` (wire the adaptor in @main App).
    func deliverBackgroundRefresh(userInfo: [String: Any]?) {
        pushNativeEvent("backgroundRefresh", payload: ["userInfo": userInfo ?? [:]])
    }

    func handleStartExtendedRuntimeSession(id: Int) {
        extendedRuntime.start()
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handleStopExtendedRuntimeSession(id: Int) {
        extendedRuntime.stop()
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handleKeychainSet(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        guard let key = fields["key"] as? String,
            let value = fields["value"] as? String
        else {
            rejectInvalid(id: id, message: "keychainSet needs key + value")
            return
        }
        if KeychainStore.set(key: key, value: value) {
            runtime?.resolveInvoke(id: id, resultJson: "null")
        } else {
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: "INTERNAL", message: "keychain write failed"))
        }
    }

    func handleKeychainGet(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        guard let key = fields["key"] as? String else {
            rejectInvalid(id: id, message: "keychainGet needs key")
            return
        }
        if let value = KeychainStore.get(key: key) {
            runtime?.resolveInvoke(id: id, resultJson: Self.jsonString(value))
        } else {
            runtime?.resolveInvoke(id: id, resultJson: "null")
        }
    }

    func handleKeychainDelete(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        guard let key = fields["key"] as? String else {
            rejectInvalid(id: id, message: "keychainDelete needs key")
            return
        }
        KeychainStore.delete(key: key)
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handleSpeak(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        guard let text = fields["text"] as? String, !text.isEmpty else {
            rejectInvalid(id: id, message: "speak needs text")
            return
        }
        speechBridge.speak(
            text: text,
            rate: fields["rate"] as? Double,
            pitch: fields["pitch"] as? Double,
            language: fields["language"] as? String,
            volume: fields["volume"] as? Double
        )
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handleStopSpeaking(id: Int) {
        speechBridge.stop()
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handlePlayAudio(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        guard let raw = fields["url"] as? String, let url = URL(string: raw) else {
            rejectInvalid(id: id, message: "playAudio needs a url")
            return
        }
        let gen = generation
        audioBridge.play(
            url: url,
            volume: fields["volume"] as? Double,
            loop: fields["loop"] as? Bool ?? false
        ) { [weak self] error in
            guard let self, gen == self.generation else { return }
            if let error {
                self.runtime?.rejectInvoke(
                    id: id,
                    errorJson: Self.errorJSON(code: "INTERNAL", message: error))
            } else {
                self.runtime?.resolveInvoke(id: id, resultJson: "null")
            }
        }
    }

    func handleStopAudio(id: Int) {
        audioBridge.stop()
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handleGetProducts(id: Int, payload: String) {
        let ids =
            (Self.decodeObject(payload)["productIds"] as? [Any])?
            .compactMap { $0 as? String } ?? []
        let gen = generation
        Task { [weak self] in
            let result = await StoreKitBridge.products(for: ids)
            await MainActor.run {
                guard let self, gen == self.generation else { return }
                self.settleStoreKit(id: id, result: result)
            }
        }
    }

    func handlePurchase(id: Int, payload: String) {
        guard let productId = Self.decodeObject(payload)["productId"] as? String else {
            rejectInvalid(id: id, message: "purchase needs productId")
            return
        }
        let gen = generation
        Task { [weak self] in
            let result = await StoreKitBridge.purchase(productId: productId)
            await MainActor.run {
                guard let self, gen == self.generation else { return }
                self.settleStoreKit(id: id, result: result)
            }
        }
    }

    func handleCurrentEntitlements(id: Int) {
        let gen = generation
        Task { [weak self] in
            let result = await StoreKitBridge.currentEntitlements()
            await MainActor.run {
                guard let self, gen == self.generation else { return }
                self.settleStoreKit(id: id, result: result)
            }
        }
    }

    func handleRestorePurchases(id: Int) {
        let gen = generation
        Task { [weak self] in
            let result = await StoreKitBridge.restore()
            await MainActor.run {
                guard let self, gen == self.generation else { return }
                self.settleStoreKit(id: id, result: result)
            }
        }
    }

    private func settleStoreKit(id: Int, result: StoreKitBridge.Result) {
        switch result {
        case .ok(let json):
            runtime?.resolveInvoke(id: id, resultJson: json)
        case .error(let message):
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: "INTERNAL", message: message))
        }
    }

    static func decodeObject(_ json: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(json.utf8)))
            as? [String: Any] ?? [:]
    }

    /// Shared INVALID_REQUEST rejection for the capability handlers.
    private func rejectInvalid(id: Int, message: String) {
        runtime?.rejectInvoke(
            id: id,
            errorJson: Self.errorJSON(code: "INVALID_REQUEST", message: message))
    }
}

#endif
