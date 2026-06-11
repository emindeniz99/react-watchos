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
        do {
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
            guard let url = Bundle.main.url(
                forResource: "bundle", withExtension: "js") else {
                startupError = "bundle.js missing — run `npm run build` in js/"
                return
            }
            runtime = js
            try js.evaluate(String(contentsOf: url, encoding: .utf8))
        } catch {
            startupError = "JS startup failed: \(error)"
        }
    }

    func dispatch(nodeId: Int, event: String, payload: [String: Any]? = nil) {
        runtime?.dispatchEvent(nodeId: nodeId, event: event, payload: payload)
    }
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
