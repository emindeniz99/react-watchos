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

    func start() {
        guard runtime == nil else { return }
        guard let url = Bundle.main.url(
            forResource: "bundle", withExtension: "js"),
            let code = try? String(contentsOf: url, encoding: .utf8) else {
            startupError = "bundle.js missing — run `npm run build` in js/"
            return
        }
        boot(code: code)
        #if DEBUG
        startDevReload()
        #endif
    }

    /// Tears down any existing runtime and evaluates `code` in a fresh one.
    private func boot(code: String) {
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
            try js.evaluate(code)
        } catch {
            startupError = "JS startup failed: \(error)"
        }
    }

    private func makeRuntime() throws -> JSRuntime {
        let js = try JSRuntime()
        js.onCommit = { [weak self] json in
            DispatchQueue.main.async {
                guard let self else { return }
                do {
                    let tree = try JSONDecoder().decode(
                        RNTree.self, from: Data(json.utf8))
                    self.root = tree.root
                    if tree.seq > self.ackedSeq {
                        self.ackedSeq = tree.seq
                        self.optimistic = self.optimistic.filter {
                            $0.value.seq > tree.seq
                        }
                    }
                } catch {
                    // Keep the previous tree; a silently-dropped commit
                    // would freeze acks and the UI with no trace.
                    self.runtimeError = "tree decode failed: \(error)"
                }
            }
        }
        js.onPublishWidgets = { json in
            SharedWidgetStore.save(json)
            WidgetCenter.shared.reloadAllTimelines()
        }
        js.onGetItem = { SharedWidgetStore.getItem($0) }
        js.onSetItem = { SharedWidgetStore.setItem($0, $1) }
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
            boot(code: code)
        }
    }
    #endif
}

@main
struct ReactWatchApp: App {
    @StateObject private var model = ReactAppModel()

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
        }
    }
}
