import AppIntents
import ReactWatchWidget
import SwiftUI
import WidgetKit

// This app's React-authored complications, Smart Stack widgets, and controls.
// The generic machinery — the React node interpreter, the timeline providers,
// the extension's QuickJS runtime, the relevance/control helpers — lives in the
// ReactWatchWidget package. This file only declares WHICH widgets exist (their
// `kind`, display name, and supported families) and the demo's one control; the
// timelines and views come from the package, parameterized by our App Group.
// NOTE: untested until built with Xcode on macOS.

struct HydrationWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "hydration",
            provider: ReactTimelineProvider(
                kind: "hydration", appGroupId: WidgetStore.appGroupId)
        ) { entry in
            reactWidgetView(entry, appGroupId: WidgetStore.appGroupId)
        }
        .configurationDisplayName("Hydration")
        .description("Glasses of water today — rendered by React.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryCorner,
            .accessoryRectangular,
            .accessoryInline,
        ])
    }
}

// ShoppingWidget (configurable: pick the list while editing the watch face)
// lives in ShoppingConfiguration.swift.

/// Multi-entry timeline demo: WidgetKit swaps between pre-rendered,
/// future-dated entries with no process running; relevance scores hint
/// the Smart Stack.
struct DaypartWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "daypart",
            provider: ReactTimelineProvider(
                kind: "daypart", appGroupId: WidgetStore.appGroupId)
        ) { entry in
            reactWidgetView(entry, appGroupId: WidgetStore.appGroupId)
        }
        .configurationDisplayName("Time of Day")
        .description("A React timeline that updates itself all day.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

/// Control Center / Action button control (watchOS 26+). The visual is an
/// OS template; React owns the metadata (label/symbol come from the
/// published payload) and the behavior (the intent dispatches into the
/// React-registered handler via QuickJS).
struct AddGlassIntent: AppIntent {
    static let title: LocalizedStringResource = "Add Glass"
    static let description = IntentDescription("Log a glass of water.")

    func perform() async throws -> some IntentResult {
        WidgetIntentRuntime.handle(
            intent: "addGlass", appGroupId: WidgetStore.appGroupId)
        return .result()
    }
}

@available(watchOS 26.0, *)
struct AddGlassControl: ControlWidget {
    /// Computed (not static let) so republished React metadata is picked
    /// up on every render instead of being frozen at process start.
    private var metadata: (label: String, systemName: String?)? {
        reactControlMetadata(
            "hydration.addGlass", appGroupId: WidgetStore.appGroupId)
    }

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "hydration.addGlass") {
            ControlWidgetButton(action: AddGlassIntent()) {
                Label(
                    metadata?.label ?? "Add Glass",
                    systemImage: metadata?.systemName ?? "drop.fill"
                )
            }
        }
        .displayName("Add Glass")
        .description("Log a glass of water — handled by React.")
    }
}

@main
struct ReactWidgetBundle: WidgetBundle {
    init() {
        // Mirror the watch app's OTA trust so the widget re-verifies the
        // known-good bundle it renders (NF-35). The app opts into unsigned dev
        // updates (WatchApp.swift `allowUnsignedUpdates: true`), so the widget
        // does too; a real app passes `signerPublicKeys:` instead (the same keys
        // it gives ReactWatchRootView).
        ReactWatchWidgetOTA.configure(allowUnsignedUpdates: true)
    }

    var body: some Widget {
        HydrationWidget()
        ShoppingWidget()
        DaypartWidget()
        if #available(watchOS 26.0, *) {
            AddGlassControl()
        }
    }
}
