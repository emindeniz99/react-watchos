import Foundation

// The App Group this widget extension shares with the watch app. Must match
// WatchApp.swift's ReactWatchRootView(appGroupId:) and the config plugin's
// appGroupId. Everything else — payload decoding, the timeline providers, the
// node interpreter, the Storage namespace — now lives in the ReactWatchWidget
// package; this target only supplies its own group id and authors its widgets.
enum WidgetStore {
    static let appGroupId = "group.com.emindeniz99.reactwatch"
}
