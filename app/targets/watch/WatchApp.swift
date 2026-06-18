import ReactWatchHost
import SwiftUI

// The watch app is now a thin consumer of the ReactWatchHost SwiftPM package:
// it embeds ReactWatchRootView and supplies app-specific config (the App
// Group for shared widget storage). The QuickJS runtime, the SwiftUI
// interpreter, and the native bridges all live in the package.
@main
struct ReactWatchApp: App {
    var body: some Scene {
        WindowGroup {
            ReactWatchRootView(appGroupId: "group.com.emindeniz99.reactwatch")
        }
    }
}
