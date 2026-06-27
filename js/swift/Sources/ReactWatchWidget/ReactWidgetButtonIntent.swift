#if os(watchOS)
import AppIntents

/// The AppIntent behind an interactive widget `Button` (watchOS 11+). The
/// node interpreter builds one per `<Button intent="…">` from the button's
/// `intent` prop + the consumer's App Group, so a tap runs that React intent
/// handler in the widget extension (the same `WidgetIntentRuntime.handle`
/// path a Control uses) — no per-app AppIntent boilerplate. The handler
/// mutates Storage and the runtime reloads the timeline.
@available(watchOS 11.0, *)
struct ReactWidgetButtonIntent: AppIntent {
    static var title: LocalizedStringResource { "Widget Action" }

    /// The registerIntent(name) to dispatch.
    @Parameter(title: "Intent") var name: String
    /// The App Group whose React runtime + shared Storage to run it against.
    @Parameter(title: "App Group") var appGroupId: String

    init() {}
    init(name: String, appGroupId: String) {
        self.name = name
        self.appGroupId = appGroupId
    }

    func perform() async throws -> some IntentResult {
        WidgetIntentRuntime.handle(intent: name, appGroupId: appGroupId)
        return .result()
    }
}
#endif
