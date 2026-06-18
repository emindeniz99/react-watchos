import ReactWatchCore
import ReactWatchRuntime
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
    /// Highest event seq React has acknowledged (tree.seq). Optimistic
    /// controls hold their local value until their dispatch is acked.
    @Published var ackedSeq = 0
    /// Optimistic values keyed by node id — lives on the model (not view
    /// @State) so it survives SwiftUI view identity changes mid-flight.
    @Published private var optimistic: [Int: (seq: Int, value: JSONValue)] = [:]

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

    init(appGroupId: String?) {
        store = SharedWidgetStore(appGroupId: appGroupId)
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
        ackedSeq = 0
        nextSeq = 1
        optimistic = [:]
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

    /// App Group file holding an OTA bundle (js/src/update.ts), if any.
    private var otaBundleURL: URL? {
        guard let group = store.appGroupId else { return nil }
        return FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("ota-bundle.js")
    }

    private func saveUpdate(_ js: String) {
        guard let url = otaBundleURL else { return }
        try? js.write(to: url, atomically: true, encoding: .utf8)
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
        if let ota = otaBundleURL,
           let code = try? String(contentsOf: ota, encoding: .utf8),
           !code.isEmpty {
            do {
                try js.evaluate(code)
                return
            } catch {
                try? FileManager.default.removeItem(at: ota)
                runtimeError = "OTA bundle failed, using shipped bundle: \(error)"
            }
        }
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
                        self.optimistic = self.optimistic.filter {
                            $0.value.seq > tree.seq
                        }
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
        js.onSaveUpdate = { [weak self] code in self?.saveUpdate(code) }
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

    private struct NotificationPayload: Decodable {
        let id: String
        let title: String
        let body: String
        let at: Double?
        let afterMs: Double?
        let sound: Bool
    }

    private func scheduleNotification(_ json: String) {
        guard let payload = try? JSONDecoder().decode(
            NotificationPayload.self, from: Data(json.utf8)) else {
            runtimeError = "bad notification payload"
            return
        }
        let content = UNMutableNotificationContent()
        content.title = payload.title
        content.body = payload.body
        if payload.sound { content.sound = .default }
        let seconds: TimeInterval
        if let at = payload.at {
            seconds = at / 1000 - Date.now.timeIntervalSince1970
        } else {
            seconds = (payload.afterMs ?? 0) / 1000
        }
        if seconds < -1 {
            runtimeError =
                "notification '\(payload.id)' scheduled in the past; delivering now"
        }
        let request = UNNotificationRequest(
            identifier: payload.id,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(
                timeInterval: max(1, seconds), repeats: false))
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

    private struct FetchRequest: Decodable {
        let url: String
        let method: String
        let headers: [String: String]?
        let body: String?
    }

    /// Runs a JS fetch over URLSession; settles the Promise back on main.
    private func performFetch(id: Int, requestJson: String) {
        guard let req = try? JSONDecoder().decode(
            FetchRequest.self, from: Data(requestJson.utf8)),
            let url = URL(string: req.url) else {
            runtime?.rejectFetch(id: id, message: "invalid fetch request")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = req.method
        req.headers?.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
        if let body = req.body { request.httpBody = Data(body.utf8) }

        let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
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
                let status = http?.statusCode ?? 0
                let bodyStr = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                var headers: [String: String] = [:]
                http?.allHeaderFields.forEach { key, value in
                    headers["\(key)".lowercased()] = "\(value)"
                }
                let payload: [String: Any] = [
                    "status": status,
                    "statusText": HTTPURLResponse.localizedString(forStatusCode: status),
                    "url": http?.url?.absoluteString ?? req.url,
                    "body": bodyStr,
                    "headers": headers,
                ]
                let json = (try? JSONSerialization.data(withJSONObject: payload))
                    .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
                self.runtime?.resolveFetch(id: id, responseJson: json)
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
        optimistic[nodeId] = (seq, value)
    }

    func optimisticBool(_ nodeId: Int) -> Bool? {
        if case .bool(let value)? = optimistic[nodeId]?.value { return value }
        return nil
    }

    func optimisticInt(_ nodeId: Int) -> Int? {
        if case .number(let value)? = optimistic[nodeId]?.value {
            return Int(value)
        }
        return nil
    }

    func optimisticDouble(_ nodeId: Int) -> Double? {
        if case .number(let value)? = optimistic[nodeId]?.value { return value }
        return nil
    }

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

/// The watch UI. Embed this in your @main App's scene; ship bundle.js as a
/// resource. `appGroupId` enables shared widget/Storage state (optional).
public struct ReactWatchRootView: View {
    @StateObject private var model: ReactWatchModel
    @Environment(\.scenePhase) private var scenePhase

    public init(appGroupId: String? = nil) {
        _model = StateObject(wrappedValue: ReactWatchModel(appGroupId: appGroupId))
    }

    public var body: some View {
        Group {
            if let root = model.root {
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
    }
}
