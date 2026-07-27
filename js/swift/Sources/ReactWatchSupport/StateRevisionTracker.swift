import Foundation

/// Batching for the App-Group state revision (ARCH-06).
///
/// Every committed state mutation has to make the revision move, or a payload
/// published afterwards could claim to describe state it never saw. But moving
/// it per *write* would mean one `NSFileCoordinator` claim per `Storage.set` —
/// and a tap that writes five keys would pay five cross-process claims for one
/// user-visible change.
///
/// The observation that makes batching safe: a consumer only ever compares a
/// payload's revision against the live one. So the revision only has to move
/// once per *mutation batch* — the writes between two payload STAMPS — because
/// every payload stamped from that batch is stamped after the move. The rule:
/// bump on the FIRST write since the batch was last closed.
///
/// A batch is closed by `closeBatch()`, at every point where the store's
/// contents stop being something this tracker can reason about:
/// * a payload was published (it now carries a revision a consumer compares);
/// * a payload SAMPLED the revision it is about to be stamped with — any write
///   landing after the sample (e.g. inside a `render()` callback) must move the
///   revision past that stamp, or the payload would certify state it was
///   computed before;
/// * another process was observed to have published (the app host's foreground
///   reconcile), because this tracker only ever sees its own writes.
///
/// Closing too often costs one extra file claim; closing too rarely lets a
/// payload read `.current` over state that moved. Fail-stale is the only
/// acceptable direction, so this errs toward closing.
///
/// Deliberately a pure value type with no I/O: the counter it gates lives in
/// `CoordinatedCounterStore`, so the batching rule is unit-tested on Linux with
/// no files, no App Group, and no watch.
public struct StateRevisionTracker: Sendable {
    /// App Group subdirectory the revision counter lives in. Deliberately NOT
    /// `counters/`: `CoordinatedCounterStore` derives a file name from the
    /// caller's key, so a bundle doing `Storage.counterAdd("state", …)` would
    /// otherwise read and write the revision itself.
    public static let subdirectory = "revision"
    /// The one counter key inside that directory — the revision is per App
    /// Group, not per storage key. A payload is derived from whatever set of
    /// keys its `render()` chose to read, which is unknowable without
    /// dependency-tracking through React; "did ANY state change" is the
    /// question a consumer can actually act on.
    public static let key = "state"

    /// False = the next write is the first of a new batch and must bump.
    private var bumpedInThisBatch = false

    public init() {}

    /// Whether the write about to happen must bump the revision first. True
    /// exactly once per batch; call it BEFORE the write lands (see the wiring
    /// sites) so a crash between the two leaves the revision AHEAD of the data.
    public mutating func needsBump() -> Bool {
        if bumpedInThisBatch { return false }
        bumpedInThisBatch = true
        return true
    }

    /// The current batch is over (a payload was published, a payload sampled the
    /// revision, or a foreign publication was observed) — the next mutation
    /// opens a new batch and moves the revision past whatever was stamped.
    public mutating func closeBatch() {
        bumpedInThisBatch = false
    }
}
