import SwiftUI
import UserNotifications
import WatchKit
import WidgetKit

/// Loads bundle.js into QuickJS and republishes every committed React
/// tree as SwiftUI state.
@MainActor
final class ReactAppModel: ObservableObject {
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

    private var runtime: JSRuntime?
    private var nextSeq = 1
    /// Serial queue for decoding committed trees off the main thread,
    /// preserving commit order.
    private let decodeQueue = DispatchQueue(label: "react.watch.decode")
    private let connectivity = PhoneConnectivity()
    private let bluetooth = BluetoothBridge()

    func start() {
        guard runtime == nil else { return }
        // Phone -> watch messages arrive as a native push, so they commit
        // instantly via runSync, exactly like any other native event.
        connectivity.onMessage = { [weak self] message in
            self?.pushNativeEvent("watchConnectivity", payload: message)
        }
        connectivity.activate()
        // BLE state/notifications reach React as native pushes (commit
        // instantly via runSync), same channel as connectivity.
        bluetooth.onState = { [weak self] state in
            self?.pushNativeEvent("ble.state", payload: ["state": state])
        }
        bluetooth.onNotify = { [weak self] characteristic, value in
            self?.pushNativeEvent(
                "ble.notify",
                payload: ["characteristic": characteristic, "value": value])
        }
        boot()
        #if DEBUG
        startDevReload()
        #endif
    }

    /// Boots a fresh runtime from the bundled code. Prefers precompiled
    /// bytecode (bundle.qbc, faster cold start) and falls back to parsing
    /// bundle.js if the bytecode is missing or version-mismatched.
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
            if let devCode {
                try js.evaluate(devCode)
            } else {
                try load(into: js)
            }
        } catch {
            startupError = "JS startup failed: \(error)"
        }
    }

    private func load(into js: JSRuntime) throws {
        if let qbc = Bundle.main.url(forResource: "bundle", withExtension: "qbc"),
           let data = try? Data(contentsOf: qbc) {
            do {
                try js.evaluateBytecode(data)
                return
            } catch {
                // Stale/mismatched bytecode — fall through to the source.
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
            // Decode the committed tree off the main thread (it's the real
            // main-thread cost for large trees — JSON parse + struct build);
            // a serial queue preserves commit order. Only @Published state
            // is touched back on main. QuickJS itself is never accessed
            // off-main, so this is isolation-safe. (Full off-main JS
            // execution is deferred — see the threading note in the README.)
            self?.decodeQueue.async {
                let decoded = try? JSONDecoder().decode(
                    RNTree.self, from: Data(json.utf8))
                DispatchQueue.main.async {
                    guard let self else { return }
                    guard let tree = decoded else {
                        self.runtimeError = "tree decode failed"
                        return
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
        js.onPublishWidgets = { json in
            SharedWidgetStore.save(json)
            WidgetCenter.shared.reloadAllTimelines()
        }
        js.onGetItem = { SharedWidgetStore.getItem($0) }
        js.onSetItem = { SharedWidgetStore.setItem($0, $1) }
        js.onSendToPhone = { [weak self] json in self?.connectivity.send(json) }
        js.onFetch = { [weak self] id, reqJson in
            self?.performFetch(id: id, requestJson: reqJson)
        }
        js.onBle = { [weak self] json in self?.bluetooth.handleOp(json) }
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
        // `at` (absolute, ms since epoch) wins over `afterMs`; clamp to
        // the 1s minimum UNTimeIntervalNotificationTrigger accepts.
        let seconds: TimeInterval
        if let at = payload.at {
            seconds = at / 1000 - Date.now.timeIntervalSince1970
        } else {
            seconds = (payload.afterMs ?? 0) / 1000
        }
        if seconds < -1 {
            // Don't silently turn a past time into "in 1 second".
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

    /// Runs a JS fetch over URLSession. The completion hops back to the main
    /// thread before settling the Promise, because the QuickJS context is
    /// single-threaded and lives on main.
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

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.runtime?.rejectFetch(
                        id: id, message: error.localizedDescription)
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
                    "status": status, "body": bodyStr, "headers": headers,
                ]
                let json = (try? JSONSerialization.data(withJSONObject: payload))
                    .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
                self.runtime?.resolveFetch(id: id, responseJson: json)
            }
        }.resume()
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
    // Live reload: polls the esbuild dev server (`npm run dev` in js/,
    // port 8788 — the watch simulator shares the Mac's network) and
    // hot-restarts the runtime when the bundle changes. Silently inert
    // when no dev server is running.
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
        // The first fetch usually matches the built-in bundle; only
        // restart once the dev server serves something newer.
        if !isFirstFetch {
            boot(devCode: code)
        }
    }
    #endif
}

@main
struct ReactWatchApp: App {
    @StateObject private var model = ReactAppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if let root = model.root {
                    // Screens own their scrolling (ScrollView/List nodes);
                    // wrapping a NavigationStack in a ScrollView breaks it.
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
                    Text(error)
                        .font(.footnote)
                        .lineLimit(2)
                        .padding(6)
                        .background(.red.opacity(0.85), in: .rect(cornerRadius: 8))
                        .onTapGesture { model.runtimeError = nil }
                }
            }
            .environmentObject(model)
            .onAppear { model.start() }
            // Example native push: lifecycle changes reach React instantly
            // via runSync (a "phase" listener can react without polling).
            .onChange(of: scenePhase) { _, phase in
                model.pushNativeEvent(
                    "scenePhase", payload: ["phase": "\(phase)"])
            }
        }
    }
}
