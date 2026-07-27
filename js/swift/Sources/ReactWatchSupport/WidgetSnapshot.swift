import Foundation
import ReactWatchCore

/// Why a stored widget payload may not be displayable as-is (ARCH-06). The
/// three failure cases are deliberately distinct rather than one `Bool`: they
/// have the same remedy (recompute in-process) but very different diagnostics,
/// and only one of them is a clock question.
public enum PayloadFreshness: Equatable, Sendable {
    /// Derived from the live state revision, produced by this release, and
    /// still inside its own re-render horizon — decode and display.
    case current
    /// State moved after this payload was rendered. It may look recent and
    /// still be describing a number the user already changed.
    case staleRevision
    /// Produced by a different JS bundle than the one this process runs — its
    /// trees may use props/components this release doesn't interpret the same
    /// way. Recompute; never blank (see the provider).
    case foreignRelease
    /// The payload's own re-render horizon has passed (the pre-ARCH-06 rule).
    case expired
}

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

    /// The full displayability verdict (ARCH-06): `isCurrent`'s time rule with
    /// the provenance stamps in front of it.
    ///
    /// Precedence is load-bearing and is revision -> release -> time:
    /// - A revision mismatch beats a not-yet-passed `reloadAfter`. That is the
    ///   entire point of the revision — an author's "this data is good until
    ///   3pm" is a statement about the CLOCK, and it cannot know the user
    ///   changed the underlying state at 2pm. Checking time first would keep
    ///   displaying provably stale numbers for the rest of the horizon.
    /// - A release mismatch beats the time rule for the same reason: the
    ///   payload's trees were authored by a bundle whose component vocabulary
    ///   this process may not share, no matter how fresh they are.
    /// - Only then does the (unchanged) time rule decide.
    ///
    /// Revision equality — not `<` — is the test. A payload claiming a revision
    /// the App Group has never reached is just as unprovable as an old one (it
    /// means the counter was lost or the payload came from another container),
    /// and the remedy is identical: recompute.
    ///
    /// A nil on EITHER side of the release comparison means "release unknown"
    /// and never rejects: the widget extension can boot precompiled bytecode
    /// with no source to hash, and a fleet where that degraded to a permanent
    /// mismatch would recompute on every single timeline request.
    public static func freshness(
        entryDates: [Date], reloadAfter: Date?, publishedAt: Date, now: Date,
        publishBurstWindow: TimeInterval = 60,
        payloadRevision: Int, currentRevision: Int,
        payloadReleaseId: String?, runningReleaseId: String?
    ) -> PayloadFreshness {
        if payloadRevision != currentRevision { return .staleRevision }
        if let payloadReleaseId, let runningReleaseId,
            payloadReleaseId != runningReleaseId
        {
            return .foreignRelease
        }
        return isCurrent(
            entryDates: entryDates, reloadAfter: reloadAfter,
            publishedAt: publishedAt, now: now,
            publishBurstWindow: publishBurstWindow) ? .current : .expired
    }

    /// Which of two payloads describes the more recent state (ARCH-06).
    ///
    /// Ordered by `stateRevision` first, `publishedAt` only as a tie-break:
    /// publication time answers "which was written last", which is NOT the same
    /// question — an in-extension re-render started before an intent's write
    /// can finish (and be written) after it, and would win on timestamp while
    /// describing older state. Within one revision nothing about the state
    /// differs, so the later publication is the better-formed one.
    ///
    /// Lives here rather than in the watchOS-only provider so the ordering rule
    /// is unit-tested on Linux.
    public static func newestPayload(
        _ first: PublishedWidgets?, _ second: PublishedWidgets?
    ) -> PublishedWidgets? {
        guard let first else { return second }
        guard let second else { return first }
        if first.stateRevision != second.stateRevision {
            return second.stateRevision > first.stateRevision ? second : first
        }
        return second.publishedAt >= first.publishedAt ? second : first
    }
}
