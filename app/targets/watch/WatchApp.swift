import ReactWatchHost
import SwiftUI

/// The watch app is now a thin consumer of the ReactWatchHost SwiftPM package:
/// it embeds ReactWatchRootView and supplies app-specific config (the App
/// Group for shared widget storage). The QuickJS runtime, the SwiftUI
/// interpreter, and the native bridges all live in the package.
@main
struct ReactWatchApp: App {
    var body: some Scene {
        WindowGroup {
            // The repo's own dev demo opts into unsigned OTA explicitly so the
            // Updates screen works against the local dev server without key
            // setup (NF-29 made refusal the zero-config default). A real app
            // sets signerPublicKeys instead — see docs/ota-signing.md.
            ReactWatchRootView(
                appGroupId: "group.com.emindeniz99.reactwatch",
                ota: .init(allowUnsignedUpdates: true)
            )
        }
    }
}
