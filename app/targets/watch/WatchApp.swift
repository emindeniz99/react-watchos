import SwiftUI

/// Loads bundle.js into QuickJS and republishes every committed React
/// tree as SwiftUI state.
@MainActor
final class ReactAppModel: ObservableObject {
    @Published var root: RNNode?
    @Published var startupError: String?

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
                    ScrollView { NodeView(node: root) }
                } else if let error = model.startupError {
                    Text(error).font(.footnote).foregroundStyle(.red)
                } else {
                    ProgressView()
                }
            }
            .environmentObject(model)
            .onAppear { model.start() }
        }
    }
}
