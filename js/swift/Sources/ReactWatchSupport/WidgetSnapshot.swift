import Foundation

/// Picks which timeline entry represents "now" (CX-016). A React-authored
/// timeline can hold future-dated entries (e.g. daypart widgets that change
/// through the day); the WidgetKit provider used `entries.last`, so snapshots and
/// the gallery showed the END-of-day state instead of the one applicable now.
/// Pure Foundation, so the selection rule is unit-tested on Linux; the provider
/// just maps its entries to dates and reads back the index.
public enum WidgetSnapshot {
    /// Index of the entry to display at `now`: the latest entry whose date is
    /// `<= now`, or — if every entry is in the future — the earliest. nil for an
    /// empty timeline.
    public static func currentIndex(dates: [Date], now: Date) -> Int? {
        guard !dates.isEmpty else { return nil }
        var current: Int?
        for (i, date) in dates.enumerated() where date <= now {
            if let c = current {
                if date > dates[c] { current = i }
            } else {
                current = i
            }
        }
        if let current { return current }
        // All entries are in the future — show the soonest one.
        var earliest = 0
        for (i, date) in dates.enumerated() where date < dates[earliest] {
            earliest = i
        }
        return earliest
    }

    /// Whether a published family timeline is still CURRENT at `now`, i.e. the
    /// widget extension can decode-and-display it without a fresh in-extension
    /// React render (a render is a full QuickJS boot — the extension's dominant
    /// avoidable cost). Pure, so the rule is unit-tested off-device.
    ///
    /// Current means the timeline's own re-render horizon hasn't passed:
    /// - `reloadAfter` set → the author declared "this data is good until
    ///   then"; current exactly while that date is in the future.
    /// - no `reloadAfter` → current while a future entry remains (WidgetKit is
    ///   just advancing pre-rendered entries), or briefly after a publish
    ///   (`publishBurstWindow`) so the reload an app/intent pushes right after
    ///   writing the store decodes that payload instead of re-rendering it.
    /// - empty timelines are never current.
    public static func isCurrent(
        entryDates: [Date], reloadAfter: Date?, publishedAt: Date, now: Date,
        publishBurstWindow: TimeInterval = 60
    ) -> Bool {
        guard !entryDates.isEmpty else { return false }
        if let reloadAfter { return reloadAfter > now }
        if entryDates.contains(where: { $0 > now }) { return true }
        return now.timeIntervalSince(publishedAt) < publishBurstWindow
    }
}
