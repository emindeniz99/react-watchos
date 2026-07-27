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
/// PUBLISHED payload's revision against the live one. So the revision only has
/// to move once per *mutation batch* — the writes between two publications —
/// because every payload published from that batch is stamped after the move.
/// This is the whole rule: bump on the FIRST write since the last publication,
/// re-arm on publication.
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
    private var bumpedSincePublish = false

    public init() {}

    /// Whether the write about to happen must bump the revision first. True
    /// exactly once per batch; call it BEFORE the write lands (see the wiring
    /// sites) so a crash between the two leaves the revision AHEAD of the data.
    public mutating func needsBump() -> Bool {
        if bumpedSincePublish { return false }
        bumpedSincePublish = true
        return true
    }

    /// A payload just went to the store — re-arm, so the next mutation opens a
    /// new batch and moves the revision past the one that payload carries.
    public mutating func notePublished() {
        bumpedSincePublish = false
    }
}
