import Foundation
import ReactWatchCore

/// Whether a freshly published payload is worth a `WidgetCenter` reload
/// (ARCH-06 follow-up 3).
///
/// A reload wakes the widget extension and spends from the watch's scarce
/// WidgetKit refresh budget — the single most expensive thing a publish can do,
/// and on battery the reason the publish path is debounced at all. But
/// `publishWidgets()` republishes on ANY Storage write (the decision
/// `intents.ts` made), and a reconcile republishes on every foreground, so a
/// large share of publications re-render to a payload the store ALREADY holds:
/// same revision, same release, same trees. The only field that always differs
/// is `publishedAt`, which the widget never displays — it feeds the
/// publish-burst window and the `newestPayload` tie-break, both of which read
/// from the store, not from a reload.
///
/// So: compare the DECODED payloads field by field, `publishedAt` excluded, and
/// skip the reload when nothing else moved. The save always still happens — the
/// stored payload's freshness bookkeeping (`publishedAt`, the burst window) is
/// exactly what must stay current; only the wake is skipped.
///
/// **Fail-open toward freshness.** Every doubt returns `true`: no previous
/// payload, either side undecodable, any field different. A spurious reload
/// costs refresh budget once; a wrongly skipped one leaves a complication
/// showing a number the user already changed until WidgetKit's own next
/// refresh, which is the failure this whole subsystem exists to prevent.
public enum WidgetPublishGate {
    /// `true` when the extension should be woken for `newJSON`.
    ///
    /// Compares decoded values, never the two JSON strings: key order,
    /// whitespace and number spelling (`1` vs `1.0`) are all free to change
    /// between two encodings of the same payload, so a string compare would
    /// answer "were these serialized identically", which is not the question.
    public static func shouldReload(previousJSON: String?, newJSON: String) -> Bool {
        guard let previousJSON else { return true }
        let decoder = JSONDecoder()
        guard
            let previous = try? decoder.decode(
                PublishedWidgets.self, from: Data(previousJSON.utf8)),
            let new = try? decoder.decode(
                PublishedWidgets.self, from: Data(newJSON.utf8))
        else { return true }
        return !sameContent(previous, new)
    }

    /// `PublishedWidgets` equality with `publishedAt` excluded.
    ///
    /// Written here, field by field, rather than as an `Equatable`-ignoring-a-
    /// field conformance on the wire struct: `PublishedWidgets` is codegen-owned
    /// (`js/codegen/schema.ts`), and its synthesized `==` is the right thing for
    /// every other caller — "is this the same publication" is a question only
    /// this gate asks. A new wire field therefore does NOT silently join the
    /// comparison; it stays absent until someone decides which side of the
    /// reload question it falls on (and the compiler says nothing, so this list
    /// is the place to look when a field stops mattering).
    private static func sameContent(_ a: PublishedWidgets, _ b: PublishedWidgets) -> Bool {
        a.v == b.v
            && a.stateRevision == b.stateRevision
            && a.releaseId == b.releaseId
            && a.widgets == b.widgets
            && a.controls == b.controls
    }
}
