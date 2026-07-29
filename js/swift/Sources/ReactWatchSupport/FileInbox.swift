import Foundation

/// The landing zone for files received over WatchConnectivity
/// (`WCSessionDelegate.session(_:didReceive:)`).
///
/// Foundation-only on purpose (the `NotificationPlan` / `HealthQueryPlan`
/// precedent): the delegate that calls this is `#if os(watchOS)` and no Linux
/// job can compile it, so every rule that can go wrong — the name
/// sanitization, the retention decision, and the containment check that stops a
/// JS-supplied path escaping the inbox — is decided here and unit-tested under
/// `swift test`.
///
/// ## Why Application Support, and why not the App Group
///
/// Apple: the system puts a received file in a temporary directory and
/// "deletes the file after [`session(_:didReceive:)`] returns", so the move is
/// mandatory and synchronous. It lands in **Application Support**, not
/// `.cachesDirectory`: caches are system-purgeable and the file has to survive
/// until JS reads it. And in the app container, not the App Group: `appGroupId`
/// is optional in `ReactWatchModel.init`, so a nil group would leave receive
/// silently broken for every app that didn't configure one.
public struct FileInbox: Sendable, Equatable {
    /// Directory name under Application Support.
    public static let directoryName = "ReactWatchInbox"

    /// Retention: the inbox keeps at most this many files…
    public static let maxFiles = 32
    /// …and drops anything older than this, whichever bites first. Without a
    /// bound the inbox grows forever on a device with single-digit GB of
    /// storage; `deleteReceivedFile` is the app's explicit release for a file
    /// it has finished with, because a native-only prune would delete files an
    /// app is still holding a path to.
    public static let maxAge: TimeInterval = 7 * 24 * 60 * 60

    /// Longest sanitized name component kept, so `<ms>-<seq>-<name>` stays well
    /// under the filesystem's 255-byte limit even for multi-byte names.
    public static let maxNameLength = 120

    public let root: URL

    public init(root: URL) {
        self.root = root
    }

    /// `Application Support/ReactWatchInbox` in this app's container, or nil
    /// when Application Support cannot be located (which is not a state a real
    /// watch app is in — the caller reports it rather than assuming a fallback
    /// directory the system may purge).
    public static func applicationSupport(
        _ fileManager: FileManager = .default
    ) -> FileInbox? {
        guard
            let support = try? fileManager.url(
                for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true)
        else { return nil }
        return FileInbox(root: support.appendingPathComponent(directoryName))
    }

    /// One directory entry, as the retention rule sees it.
    public struct Entry: Sendable, Equatable {
        public let url: URL
        public let modified: Date

        public init(url: URL, modified: Date) {
            self.url = url
            self.modified = modified
        }
    }

    /// A file name that is safe as a single path component: no separators, no
    /// traversal, no control characters, never empty.
    ///
    /// The name comes from the SENDER — an iPhone app this watch app may not
    /// own — so it is untrusted input on the way to a filesystem path.
    public static func sanitize(_ name: String) -> String {
        // `:` as well as `/`: it is the legacy HFS separator and Foundation
        // still translates it in display names.
        let illegal = CharacterSet(charactersIn: "/:\\\0")
            .union(.controlCharacters)
        let cleaned = String(
            String.UnicodeScalarView(
                name.unicodeScalars.filter { !illegal.contains($0) }))
        // `.` / `..` survive the filter above and are exactly the traversal
        // components the filter exists to stop.
        let trimmed = cleaned.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed != ".", trimmed != ".." else {
            return "file"
        }
        return String(trimmed.prefix(maxNameLength))
    }

    /// Where a received file lands. `receivedAtMs` + `sequence` is what makes
    /// the name unique: the sequence alone resets with the process, so a file
    /// received in a later launch could otherwise overwrite one this app is
    /// still holding a path to.
    public func landingURL(
        receivedAtMs: Int, sequence: Int, name: String
    ) -> URL {
        root.appendingPathComponent(
            "\(receivedAtMs)-\(sequence)-\(Self.sanitize(name))")
    }

    /// Moves `source` into the inbox and returns where it landed. MUST be
    /// called synchronously from `session(_:didReceive:)` — the system deletes
    /// the source as soon as that method returns.
    public func adopt(
        _ source: URL, receivedAtMs: Int, sequence: Int, name: String,
        fileManager: FileManager = .default
    ) throws -> URL {
        try fileManager.createDirectory(
            at: root, withIntermediateDirectories: true)
        let destination = landingURL(
            receivedAtMs: receivedAtMs, sequence: sequence, name: name)
        // Only reachable on an exact millisecond + sequence collision. Removing
        // first is still better than letting `moveItem` throw: the source is
        // about to be deleted by the system either way, so a throw loses the
        // NEW file to protect a stale one with an identical name.
        if fileManager.fileExists(atPath: destination.path) {
            try? fileManager.removeItem(at: destination)
        }
        try fileManager.moveItem(at: source, to: destination)
        // `moveItem` is a rename, so the landed file keeps the SOURCE's
        // modification date — a date this app did not choose. The source is a
        // temp file the WatchConnectivity daemon wrote, and Apple documents no
        // attribute-preservation contract for it either way (the metadata
        // dictionary is the documented channel for ancillary data), so an
        // inherited date can be arbitrarily old. `maxAge` below means "7 days
        // since RECEIPT" — every doc says so — so stamp receipt time and make
        // that true instead of trusting a date from the sender's filesystem.
        // Best-effort on purpose: the file is already safe, and throwing here
        // would report `receiveFailed` for a file that actually landed.
        try? fileManager.setAttributes(
            [
                .modificationDate: Date(
                    timeIntervalSince1970: Double(receivedAtMs) / 1000)
            ],
            ofItemAtPath: destination.path)
        return destination
    }

    /// Which entries retention drops: everything past `maxFiles` newest-first,
    /// plus everything older than `maxAge`. Pure, so the rule is testable
    /// without a filesystem.
    ///
    /// `protected` is never dropped, whatever its age or position. The caller
    /// that receives files delivers their events ASYNCHRONOUSLY, so a file can
    /// be on disk before JS has been handed its path; deleting it then is
    /// silent loss the app cannot even report, because `deleteReceivedFile`
    /// needs the path it never got. Protected entries keep their place in the
    /// newest-first ordering rather than being lifted out of it, so an empty
    /// set behaves byte-identically to the plain rule.
    ///
    /// The bound this relaxes is a bound on STEADY state, not a hard ceiling:
    /// while a burst is still undelivered the inbox may hold more than
    /// `maxFiles`, collapsing back as soon as the events drain. That overshoot
    /// is bounded by the burst size. Capping the protected set instead would
    /// give a hard 2x ceiling but would reintroduce the dead path for the
    /// oldest undelivered file, which is the bug this parameter exists to fix.
    public static func victims(
        _ entries: [Entry], now: Date,
        maxFiles: Int = FileInbox.maxFiles, maxAge: TimeInterval = FileInbox.maxAge,
        protected: Set<URL> = []
    ) -> [URL] {
        let newestFirst = entries.sorted { $0.modified > $1.modified }
        var drop: [URL] = []
        for (index, entry) in newestFirst.enumerated() {
            if protected.contains(entry.url) { continue }
            if index >= maxFiles
                || now.timeIntervalSince(entry.modified) > maxAge
            {
                drop.append(entry.url)
            }
        }
        return drop
    }

    /// Applies `victims` to the real directory. Returns what it removed. A
    /// missing/unreadable inbox prunes nothing rather than throwing: pruning is
    /// housekeeping on the receive path and must never fail a delivery.
    @discardableResult
    public func prune(
        now: Date = Date(), protecting protected: Set<URL> = [],
        fileManager: FileManager = .default
    ) -> [URL] {
        guard
            let contents = try? fileManager.contentsOfDirectory(
                at: root, includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles])
        else { return [] }
        let entries = contents.map { url in
            Entry(
                url: url,
                modified: (try? url.resourceValues(
                    forKeys: [.contentModificationDateKey]
                ).contentModificationDate) ?? .distantPast)
        }
        var removed: [URL] = []
        for url in Self.victims(entries, now: now, protected: protected) {
            if (try? fileManager.removeItem(at: url)) != nil { removed.append(url) }
        }
        return removed
    }

    /// Resolves a path JS handed back (the `file://` URL a `watchConnectivity.file`
    /// event carried, or the bare path) to a URL INSIDE this inbox — nil for
    /// anything else.
    ///
    /// This is the whole reason `deleteReceivedFile` takes a path at all rather
    /// than being a native-only LRU: without the containment check, a bundle
    /// could hand back `…/ReactWatchInbox/../../Library/Preferences/…` and have
    /// the host delete it. Standardizing first is what resolves `..` before the
    /// prefix compare, so the check cannot be walked around.
    public func resolve(path: String) -> URL? {
        let url: URL
        if path.hasPrefix("file://"), let parsed = URL(string: path) {
            url = parsed
        } else if path.hasPrefix("/") {
            url = URL(fileURLWithPath: path)
        } else {
            return nil
        }
        let resolved = url.standardizedFileURL.path
        let base = root.standardizedFileURL.path
        guard resolved.hasPrefix(base + "/"), resolved.count > base.count + 1
        else { return nil }
        return URL(fileURLWithPath: resolved)
    }
}
