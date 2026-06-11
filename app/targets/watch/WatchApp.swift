import SwiftUI
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

    private var runtime: JSRuntime?

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
            let tree = try? JSONDecoder().decode(
                RNTree.self, from: Data(json.utf8))
            DispatchQueue.main.async { self?.root = tree?.root }
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
        return js
    }

    func dispatch(nodeId: Int, event: String, payload: [String: Any]? = nil) {
        runtime?.dispatchEvent(nodeId: nodeId, event: event, payload: payload)
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
