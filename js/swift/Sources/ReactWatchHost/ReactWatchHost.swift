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
    private var runtime: JSRuntime?
    private var nextSeq = 1
    /// Set once after reporting a renderer-vs-runtime wire mismatch.
    private var warnedWireMismatch = false
    /// Serial queue for decoding committed trees off the main thread.
    private let decodeQueue = DispatchQueue(label: "react.watch.decode")
    private let connectivity = PhoneConnectivity()
    private let bluetooth = BluetoothBridge()
    private let sensors = SensorBridge()
    private var fetchTasks: [Int: URLSessionDataTask] = [:]

    /// OTA verification config (CR-4 / CR-17). `updatePublicKey` nil = fail-open
    /// (load unsigned + warn). `updateGate` .hard refuses to boot stale JS;
    /// `shippedBundleVersion` is the compatibility version of the bundle in the
    /// app binary, used for the anti-rollback boot decision.
    private let updatePublicKey: Curve25519.Signing.PublicKey?
    private let updateGate: OTAGate
    private let shippedBundleVersion: Int
    private let updateManifestURL: String?

    init(appGroupId: String?, ota: OTAConfig = .init()) {
        store = SharedWidgetStore(appGroupId: appGroupId)
        updatePublicKey = ota.publicKeyBase64
            .flatMap { Data(base64Encoded: $0) }
            .flatMap { try? Curve25519.Signing.PublicKey(rawRepresentation: $0) }
        updateGate = ota.gate
        shippedBundleVersion = ota.shippedVersion
        updateManifestURL = ota.manifestURL
    }

    func start() {
        guard runtime == nil else { return }
        connectivity.onMessage = { [weak self] message in
            self?.pushNativeEvent("watchConnectivity", payload: message)
        }
        connectivity.activate()
        bluetooth.onState = { [weak self] state in
            self?.pushNativeEvent("ble.state", payload: ["state": state])
        }
        bluetooth.onNotify = { [weak self] characteristic, value in
            self?.pushNativeEvent(
                "ble.notify",
                payload: ["characteristic": characteristic, "value": value])
        }
        sensors.onReading = { [weak self] kind, payload in
            self?.pushNativeEvent("sensor.\(kind)", payload: payload)
        }
        boot()
        #if DEBUG
        startDevReload()
        #endif
    }

    /// Boots a fresh runtime, preferring precompiled bytecode (bundle.qbc)
    /// and falling back to parsing bundle.js.
    private func boot(devCode: String? = nil) {
        runtime = nil
        root = nil
        runtimeError = nil
        startupError = nil
        updateRequired = false
        ackedSeq = 0
        nextSeq = 1
        optimistic = OptimisticStore()
        do {
            let js = try makeRuntime()
            runtime = js
            #if DEBUG
            try? js.evaluate(
                "globalThis.__inspectorUrl='http://127.0.0.1:8099/snapshot'")
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

    /// App Group files holding an OTA bundle (js/src/update.ts) + its metadata
    /// (compatibility version + base64 Ed25519 signature).
    private var otaBundleURL: URL? { appGroupFile("ota-bundle.js") }
    private var otaMetaURL: URL? { appGroupFile("ota-meta.json") }
    /// On-device-compiled bytecode cache for the OTA bundle (CR-17), so a cold
    /// start skips the parser. Derived from the verified source at save time.
    private var otaBytecodeURL: URL? { appGroupFile("ota-bundle.qbc") }
    private func appGroupFile(_ name: String) -> URL? {
        guard let group = store.appGroupId else { return nil }
        return FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent(name)
    }

    /// Sidecar for the persisted OTA bundle.
    private struct OTAMeta: Codable {
        let version: Int?
        let signature: String? // base64 Ed25519 over UpdatePlan.signedMessage
    }

    /// Ceiling for an OTA bundle. The app parses the whole source through
    /// QuickJS at launch, so a multi-MB bundle risks an out-of-memory kill on a
    /// memory-tight watch (the atomic write also needs ~2x transiently). Reject
    /// past this rather than persist something that can't load.
    private static let maxOTABundleBytes = 3 * 1024 * 1024

    /// Persists an OTA bundle (CR-4 / CR-17). An OTA bundle is arbitrary JS with
    /// the full host surface, so with a key configured the signature is verified
    /// over `scheme:version:js` *before* it's written — the version is inside the
    /// signed bytes, so it can't be relabelled (anti-rollback in `load` can trust
    /// it). An unsigned or bad bundle is refused. With no key it's fail-open:
    /// persisted with a loud warning so an un-updated consumer keeps working.
    /// Returns whether the bundle was accepted + persisted (false = rejected,
    /// with `runtimeError` set) — the native recovery path reboots only on true.
    @discardableResult
    private func saveUpdate(_ payload: String) -> Bool {
        guard let url = otaBundleURL, let metaURL = otaMetaURL else { return false }
        let plan = UpdatePlan(payload: payload)
        let size = plan.js.utf8.count
        guard size <= Self.maxOTABundleBytes else {
            runtimeError = "OTA update rejected: bundle is \(size) bytes, over the "
                + "\(Self.maxOTABundleBytes)-byte limit"
            return false
        }
        if let key = updatePublicKey {
            guard let signature = plan.signature, let version = plan.version,
                  let message = plan.signedMessage(),
                  key.isValidSignature(signature, for: message) else {
                runtimeError = "OTA update rejected: signature/version missing or invalid"
                return false
            }
            let highWater = store.otaHighWater()
            guard VersionPolicy.accepts(incoming: version, highWater: highWater) else {
                runtimeError = "OTA update rejected: version \(version) is older than the "
                    + "installed \(highWater) (downgrade blocked)"
                return false
            }
            persistOTA(js: plan.js, version: version,
                       signature: signature.base64EncodedString(), url: url, metaURL: metaURL)
        } else {
            print("[ReactWatch] WARNING: persisting OTA bundle WITHOUT signature "
                + "verification — set updatePublicKeyBase64 to enforce (CR-4).")
            persistOTA(js: plan.js, version: plan.version, signature: nil,
                       url: url, metaURL: metaURL)
        }
        return true
    }

    private func persistOTA(
        js: String, version: Int?, signature: String?, url: URL, metaURL: URL
    ) {
        guard (try? js.write(to: url, atomically: true, encoding: .utf8)) != nil else { return }
        let meta = OTAMeta(version: version, signature: signature)
        if let data = try? JSONEncoder().encode(meta) {
            try? data.write(to: metaURL, options: .atomic)
        }
        cacheOTABytecode(source: js)
    }

    /// Compiles the just-verified OTA source to bytecode now (CR-17) so the next
    /// cold start skips the parser. Compiled in a throwaway runtime — the same
    /// quickjs-ng, so it's version-matched — to avoid touching the live context;
    /// on failure the stale cache is dropped and load falls back to the source.
    private func cacheOTABytecode(source: String) {
        guard let bcURL = otaBytecodeURL else { return }
        if let bytecode = (try? JSRuntime())?.compileToBytecode(source) {
            try? bytecode.write(to: bcURL, options: .atomic)
        } else {
            try? FileManager.default.removeItem(at: bcURL)
        }
    }

    private func loadOTAMeta() -> OTAMeta? {
        guard let metaURL = otaMetaURL, let data = try? Data(contentsOf: metaURL) else {
            return nil
        }
        return try? JSONDecoder().decode(OTAMeta.self, from: data)
    }

    private func dropOTA() {
        if let url = otaBundleURL { try? FileManager.default.removeItem(at: url) }
        if let metaURL = otaMetaURL { try? FileManager.default.removeItem(at: metaURL) }
        if let bcURL = otaBytecodeURL { try? FileManager.default.removeItem(at: bcURL) }
    }

    /// Remote manifest served at `OTAConfig.manifestURL` ({version, bundle,
    /// signature}); `bundle` is absolute or relative to the manifest URL.
    private struct RemoteManifest: Decodable {
        let version: Int
        let bundle: String
        let signature: String?
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
            guard let js = String(data: jsData, encoding: .utf8) else {
                runtimeError = "update bundle was not UTF-8 text"
                return
            }
            var payload: [String: Any] = ["js": js, "version": manifest.version]
            if let signature = manifest.signature { payload["signature"] = signature }
            guard let payloadData = try? JSONSerialization.data(withJSONObject: payload),
                  let payloadString = String(data: payloadData, encoding: .utf8),
                  saveUpdate(payloadString) else { return }
            boot() // re-load; the staged bundle (>= high-water) now runs
        } catch {
            runtimeError = "update check failed: \(error.localizedDescription)"
        }
    }

    private struct GenerateRequest: Decodable {
        let prompt: String
        let instructions: String?
        let temperature: Double?
    }

    /// On-device text generation via Foundation Models (js/src/ai.ts).
    private func generate(id: Int, requestJson: String) {
        guard let req = try? JSONDecoder().decode(
            GenerateRequest.self, from: Data(requestJson.utf8)) else {
            runtime?.rejectGenerate(id: id, message: "bad request")
            return
        }
        #if canImport(FoundationModels)
        if #available(watchOS 26.0, *) {
            Task { [weak self] in
                do {
                    let session = LanguageModelSession(
                        instructions: req.instructions ?? "")
                    var options = GenerationOptions()
                    if let t = req.temperature { options.temperature = t }
                    let response = try await session.respond(
                        to: req.prompt, options: options)
                    await MainActor.run {
                        self?.runtime?.resolveGenerate(id: id, text: response.content)
                    }
                } catch {
                    await MainActor.run {
                        self?.runtime?.rejectGenerate(
                            id: id, message: error.localizedDescription)
                    }
                }
            }
            return
        }
        #endif
        runtime?.rejectGenerate(id: id, message: "on-device AI unavailable")
    }

    private func load(into js: JSRuntime) throws {
        let candidate = otaCandidate()
        let decision: BootDecision
        if updatePublicKey == nil {
            // Fail-open: versions are unverified, so no anti-rollback — run the
            // OTA bundle if present, else shipped.
            decision = candidate != nil ? .runOTA : .runShipped
        } else {
            decision = VersionPolicy.decide(
                otaVersion: candidate.flatMap(\.version),
                highWater: store.otaHighWater(),
                shippedVersion: shippedBundleVersion,
                gate: updateGate)
        }
        switch decision {
        case .runOTA:
            if let c = candidate {
                do {
                    try evaluateOTA(c.code, into: js)
                    if let v = c.version {
                        store.setOTAHighWater(
                            VersionPolicy.bumpedHighWater(store.otaHighWater(), booted: v))
                    }
                    return
                } catch {
                    dropOTA()
                    runtimeError = "OTA bundle failed, using shipped bundle: \(error)"
                }
            }
        case .blockForUpdate:
            // Hard gate: the only available bundle is older than one already
            // applied — refuse to boot it so it can't write to a newer-schema db.
            updateRequired = true
            return
        case .runShipped:
            break
        }
        try loadShipped(into: js)
        if updatePublicKey != nil {
            store.setOTAHighWater(
                VersionPolicy.bumpedHighWater(store.otaHighWater(), booted: shippedBundleVersion))
        }
    }

    /// The persisted OTA bundle + its version. The signature was verified at
    /// save (the network boundary); the App Group is a trusted local sandbox,
    /// so load doesn't re-verify — which is what lets it run the unsigned local
    /// bytecode cache. nil if none.
    private func otaCandidate() -> (code: String, version: Int?)? {
        guard let ota = otaBundleURL,
              let code = try? String(contentsOf: ota, encoding: .utf8),
              !code.isEmpty else { return nil }
        return (code, loadOTAMeta()?.version)
    }

    /// Runs the OTA bundle, preferring the on-device bytecode cache (no parser);
    /// falls back to parsing the source if the cache is missing or stale (e.g.
    /// the embedded quickjs-ng changed in a native release, so the cached
    /// bytecode no longer loads).
    private func evaluateOTA(_ source: String, into js: JSRuntime) throws {
        if let bcURL = otaBytecodeURL, let data = try? Data(contentsOf: bcURL) {
            do {
                try js.evaluateBytecode(data)
                return
            } catch {
                try? FileManager.default.removeItem(at: bcURL) // stale cache
            }
        }
        try js.evaluate(source)
    }

    private func loadShipped(into js: JSRuntime) throws {
        if let qbc = Bundle.main.url(forResource: "bundle", withExtension: "qbc"),
           let data = try? Data(contentsOf: qbc) {
            do {
                try js.evaluateBytecode(data)
                return
            } catch {
                runtimeError = "bytecode load failed, using bundle.js: \(error)"
            }
        }
        guard let jsURL = Bundle.main.url(forResource: "bundle", withExtension: "js"),
              let code = try? String(contentsOf: jsURL, encoding: .utf8) else {
            throw JSRuntime.JSError.exception("bundle.js missing — run `npm run build`")
        }
        try js.evaluate(code)
    }

    private func makeRuntime() throws -> JSRuntime {
        let js = try JSRuntime()
        js.onCommit = { [weak self] json in
            self?.decodeQueue.async {
                let decoded = try? JSONDecoder().decode(
                    RNTree.self, from: Data(json.utf8))
                DispatchQueue.main.async {
                    guard let self else { return }
                    guard let tree = decoded else {
                        self.runtimeError = "tree decode failed"
                        return
                    }
                    // The JS bundle and this native target version
                    // independently; a wire-version mismatch means the tree
                    // may mis-decode silently. Surface it loudly (once).
                    if tree.v != RNWire.version, !self.warnedWireMismatch {
                        self.warnedWireMismatch = true
                        self.runtimeError =
                            "wire version mismatch: bundle v\(tree.v) vs "
                            + "runtime v\(RNWire.version) — rebuild the bundle"
                    }
                    self.root = tree.root
                    if tree.seq > self.ackedSeq {
                        self.ackedSeq = tree.seq
                        self.optimistic.ack(throughSeq: tree.seq)
                    }
                }
            }
        }
        js.onPublishWidgets = { [store] json in
            store.save(json)
            WidgetCenter.shared.reloadAllTimelines()
        }
        js.onGetItem = { [store] in store.getItem($0) }
        js.onSetItem = { [store] in store.setItem($0, $1) }
        js.onSendToPhone = { [weak self] json in self?.connectivity.send(json) }
        js.onFetch = { [weak self] id, reqJson in
            self?.performFetch(id: id, requestJson: reqJson)
        }
        js.onAbortFetch = { [weak self] id in self?.abortFetch(id: id) }
        js.onBle = { [weak self] json in self?.bluetooth.handleOp(json) }
        js.onSensor = { [weak self] json in self?.sensors.handleOp(json) }
        js.onSaveUpdate = { [weak self] code in _ = self?.saveUpdate(code) }
        js.onGenerate = { [weak self] id, reqJson in
            self?.generate(id: id, requestJson: reqJson)
        }
        js.onError = { [weak self] message in
            DispatchQueue.main.async { self?.runtimeError = message }
        }
        js.onPlayHaptic = { type in
            let haptic: WKHapticType = switch type {
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
        js.onRequestNotificationPermission = {
            UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .sound]) { _, _ in }
        }
        js.onScheduleNotification = { [weak self] json in
            self?.scheduleNotification(json)
        }
        js.onCancelNotification = { id in
            UNUserNotificationCenter.current()
                .removePendingNotificationRequests(withIdentifiers: [id])
        }
        return js
    }

    private func scheduleNotification(_ json: String) {
        // Decode + trigger-time math is ReactWatchSupport.NotificationPlan
        // (unit-tested on Linux); the host just builds the request from it.
        guard let plan = NotificationPlan(json: json) else {
            runtimeError = "bad notification payload"
            return
        }
        if plan.scheduledInPast {
            runtimeError =
                "notification '\(plan.id)' scheduled in the past; delivering now"
        }
        let content = UNMutableNotificationContent()
        content.title = plan.title
        content.body = plan.body
        if plan.sound { content.sound = .default }
        let request = UNNotificationRequest(
            identifier: plan.id,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(
                timeInterval: plan.triggerSeconds, repeats: false))
        UNUserNotificationCenter.current().add(request) { [weak self] error in
            if let error {
                DispatchQueue.main.async {
                    self?.runtimeError = "notification: \(error.localizedDescription)"
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
            nodeId: nodeId, event: event, payload: payload, seq: seq)
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
        let task = URLSession.shared.dataTask(with: plan.request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.fetchTasks[id] = nil
                if let error {
                    if (error as NSError).code != NSURLErrorCancelled {
                        self.runtime?.rejectFetch(
                            id: id, message: error.localizedDescription)
                    }
                    return
                }
                let http = response as? HTTPURLResponse
                var headers: [String: String] = [:]
                http?.allHeaderFields.forEach { key, value in
                    // Repeated headers (e.g. Set-Cookie) arrive as an array;
                    // WHATWG joins them with ", ", not Swift's "[a, b]"
                    // array description.
                    let joined = (value as? [Any]).map { array in
                        array.map { "\($0)" }.joined(separator: ", ")
                    } ?? "\(value)"
                    headers["\(key)".lowercased()] = joined
                }
                let status = http?.statusCode ?? 0
                let url = http?.url?.absoluteString ?? plan.url
                switch FetchResponse.classifyBody(data) {
                case let .tooLarge(bytes, limit):
                    // Don't bridge an unbounded body into the watch's tight
                    // QuickJS heap — fail loud instead of risking OOM.
                    self.runtime?.rejectFetch(
                        id: id,
                        message: "response body too large: \(bytes) bytes "
                            + "exceeds \(limit)-byte limit")
                case let .text(text):
                    self.runtime?.resolveFetch(
                        id: id,
                        responseJson: FetchResponse.json(
                            status: status, url: url, body: text,
                            headers: headers))
                case let .base64(encoded):
                    // Binary body — carried as base64 so it isn't silently
                    // dropped (the old UTF-8 decode turned it into "").
                    self.runtime?.resolveFetch(
                        id: id,
                        responseJson: FetchResponse.json(
                            status: status, url: url, body: encoded,
                            headers: headers, bodyEncoding: "base64"))
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

    /// Dispatches a change event and remembers `value` as the node's
    /// optimistic value until React acks this dispatch.
    func dispatchOptimistic(nodeId: Int, value: JSONValue, payload: [String: Any]) {
        let seq = dispatch(nodeId: nodeId, event: "change", payload: payload)
        optimistic.set(nodeId: nodeId, seq: seq, value: value)
    }

    func optimisticBool(_ nodeId: Int) -> Bool? { optimistic.bool(nodeId) }
    func optimisticInt(_ nodeId: Int) -> Int? { optimistic.int(nodeId) }
    func optimisticDouble(_ nodeId: Int) -> Double? { optimistic.double(nodeId) }
    func optimisticString(_ nodeId: Int) -> String? { optimistic.string(nodeId) }

    #if DEBUG
    private static let devBundleURL = URL(string: "http://127.0.0.1:8788/bundle.js")!
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
              !code.isEmpty, code != lastDevBundle else { return }
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
    /// Base64 Ed25519 public key. nil = fail-open: bundles load unsigned with a
    /// loud warning. Set it to enforce signed updates + anti-rollback.
    public var publicKeyBase64: String?
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

    public init(
        publicKeyBase64: String? = nil, gate: OTAGate = .soft,
        shippedVersion: Int = 1, manifestURL: String? = nil
    ) {
        self.publicKeyBase64 = publicKeyBase64
        self.gate = gate
        self.shippedVersion = shippedVersion
        self.manifestURL = manifestURL
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
public struct ReactWatchRootView: View {
    @StateObject private var model: ReactWatchModel
    @Environment(\.scenePhase) private var scenePhase

    public init(appGroupId: String? = nil, ota: OTAConfig = .init()) {
        _model = StateObject(wrappedValue: ReactWatchModel(appGroupId: appGroupId, ota: ota))
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
#endif
