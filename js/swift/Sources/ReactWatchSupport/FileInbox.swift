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

    /// The retention date for a directory entry, FAIL-CLOSED: an entry whose
    /// `contentModificationDate` could not be read counts as the newest thing
    /// in the inbox, never the oldest.
    ///
    /// This is the whole rule, extracted so it is decidable on Linux — the
    /// unreadable state itself cannot be synthesized here (even a broken
    /// symlink reports the link's own date), so the decision is tested rather
    /// than the I/O. It used to fall back to `.distantPast`, which made an
    /// unreadable attribute mean "older than everything" and therefore
    /// "delete": a fail-OPEN-to-delete, on the receive path, for a file this
    /// app cannot say anything about. Deleting received user data is
    /// irreversible and silent (nothing reports a prune), so the unknown case
    /// has to keep the file, not drop it.
    ///
    /// The cost is stated rather than hidden: a sentinel this new also sorts
    /// AHEAD of real files, so an unreadable entry occupies a `maxFiles` slot
    /// and can displace a genuinely-newest file. That keeps the inbox BOUNDED
    /// (skipping such entries entirely would not — and the bound is why
    /// retention exists at all), at the price of one slot per unreadable entry.
    public static func retentionDate(_ modified: Date?) -> Date {
        modified ?? .distantFuture
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
                modified: Self.retentionDate(
                    try? url.resourceValues(
                        forKeys: [.contentModificationDateKey]
                    ).contentModificationDate))
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

    // MARK: - Reading a received file

    /// Hard ceiling on ONE bridged chunk — a reject, not a budget.
    ///
    /// Deliberately the SAME number as `FetchResponse.defaultMaxBodyBytes`, and
    /// deliberately not a `BudgetPolicy` entry. `BudgetPolicy`'s caps are soft
    /// (ARCH-13: warn once, proceed) because the real authority is elsewhere —
    /// `WCError`, not our number, decides what is too large to transfer. Here
    /// the authority is the QuickJS heap, which is a hard limit, so this joins
    /// the hard ceilings (`FetchResponse.defaultMaxBodyBytes`, the host's OTA
    /// bundle limit) instead. It bounds the identical thing `fetch` bounds —
    /// one string, base64-inflated, JSON-wrapped, copied into the runtime's
    /// heap — so referencing that constant rather than inventing a second
    /// number keeps one number for one constraint.
    public static var maxReadBytes: Int { FetchResponse.defaultMaxBodyBytes }

    /// Clamps a requested range against the file and the chunk ceiling.
    ///
    /// Every refusal here is a CALLER error and says so. The alternative —
    /// quietly returning a different range than the one asked for — is exactly
    /// the silent class this op exists to remove.
    public static func readWindow(
        offset: Int, length: Int?, totalBytes: Int,
        maxBytes: Int = FileInbox.maxReadBytes
    ) -> Result<ReceivedFileReadWindow, ReceivedFileReadError> {
        guard offset >= 0 else {
            return .failure(
                ReceivedFileReadError(.invalidRequest, "offset must not be negative"))
        }
        guard offset <= totalBytes else {
            return .failure(
                ReceivedFileReadError(
                    .invalidRequest,
                    "offset \(offset) is past the end of a \(totalBytes)-byte file"))
        }
        if let length {
            guard length > 0 else {
                return .failure(
                    ReceivedFileReadError(
                        .invalidRequest, "length must be a positive byte count"))
            }
            guard length <= maxBytes else {
                return .failure(
                    ReceivedFileReadError(
                        .invalidRequest,
                        "length \(length) is over the \(maxBytes)-byte chunk ceiling"
                            + " — read the file in successive chunks"))
            }
        }
        var window = Swift.min(length ?? maxBytes, totalBytes - offset)
        if offset + window < totalBytes {
            // A chunk that does NOT end the file is trimmed to a multiple of 3,
            // so the base64 of successive chunks CONCATENATES into the base64 of
            // the whole file. Without this, a caller doing `atob(a + b)` gets
            // silently wrong bytes at every boundary — base64 pads a partial
            // 3-byte group, and the padding lands mid-file.
            window -= window % 3
            guard window > 0 else {
                return .failure(
                    ReceivedFileReadError(
                        .invalidRequest,
                        "a chunk that does not reach the end of the file must be"
                            + " at least 3 bytes, so its base64 concatenates"))
            }
        }
        return .success(ReceivedFileReadWindow(offset: offset, length: window))
    }

    /// Reads one base64 chunk of a file this app received.
    ///
    /// The byte-reading API the package otherwise had no form of: `fetch` is
    /// gated on the `network` feature while the file ops are `connectivity`, so
    /// a bundle narrowed to `connectivity` was handed paths it could not open —
    /// and `file://` honours no HTTP Range, so a file over the bridge's body
    /// ceiling had no readable form at all. Chunking closes the second half:
    /// the ceiling bounds one CHUNK, not the file.
    ///
    /// Containment is `resolve`'s, unchanged — the same check that stops
    /// `deleteReceivedFile` addressing anything outside the inbox stops this
    /// reading it.
    public func read(
        _ plan: ReceivedFileReadPlan, fileManager: FileManager = .default
    ) -> Result<ReceivedFileChunk, ReceivedFileReadError> {
        guard let url = resolve(path: plan.path) else {
            return .failure(
                ReceivedFileReadError(
                    .invalidRequest, "\(plan.path) is not a file this app received"))
        }
        // Deliberately a different answer from the containment refusal above:
        // this path WAS addressable, so "it is gone" is the honest report, and
        // it is what tells an app retention reclaimed the file.
        guard let attributes = try? fileManager.attributesOfItem(atPath: url.path),
            let totalBytes = attributes[.size] as? Int
        else {
            return .failure(
                ReceivedFileReadError(
                    .invalidRequest,
                    "\(plan.path) is no longer in the inbox — it was deleted or"
                        + " reclaimed by retention"))
        }
        let window: ReceivedFileReadWindow
        switch Self.readWindow(
            offset: plan.offset, length: plan.length, totalBytes: totalBytes)
        {
        case .success(let value): window = value
        case .failure(let error): return .failure(error)
        }
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            return .failure(
                ReceivedFileReadError(
                    .internal, "could not open \(plan.path) for reading"))
        }
        defer { try? handle.close() }
        let data: Data
        do {
            try handle.seek(toOffset: UInt64(window.offset))
            data = try handle.read(upToCount: window.length) ?? Data()
        } catch {
            return .failure(
                ReceivedFileReadError(
                    .internal,
                    "could not read \(plan.path): \(error.localizedDescription)"))
        }
        return .success(
            ReceivedFileChunk(
                base64: data.base64EncodedString(),
                bytes: data.count,
                offset: window.offset,
                totalBytes: totalBytes,
                // From what was actually READ, never from what was asked for, so
                // a short read cannot claim to have ended the file.
                eof: window.offset + data.count >= totalBytes))
    }
}

/// Why a `readReceivedFile` was refused. Carries the invoke code, so the
/// watchOS adapter only re-wraps it — the classification (a caller error vs a
/// host failure) is decided here, on Linux.
public struct ReceivedFileReadError: Error, Equatable, Sendable,
    CustomStringConvertible
{
    public let code: InvokeErrorCode
    public let message: String

    public init(_ code: InvokeErrorCode, _ message: String) {
        self.code = code
        self.message = message
    }

    public var description: String { message }
}

/// A validated `readReceivedFile` request.
public struct ReceivedFileReadPlan: Equatable, Sendable {
    public let path: String
    public let offset: Int
    /// nil = "as much as one chunk may carry".
    public let length: Int?

    public init(path: String, offset: Int = 0, length: Int? = nil) {
        self.path = path
        self.offset = offset
        self.length = length
    }

    private struct Payload: Decodable {
        let path: String?
        // Decoded as Double, not Int, so a number that is not a whole byte
        // count is NAMED by `wholeBytes` below. As `Int?` it failed the whole
        // payload decode, and the one guard reported that as a missing `path`
        // — the wire type is `offset?: number`, a JS double, so
        // `{ offset: file.size / 2 }` is type-legal and lands here fractional.
        let offset: Double?
        let length: Double?
    }

    public static func decode(
        json: String
    ) -> Result<ReceivedFileReadPlan, ReceivedFileReadError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else {
            return .failure(
                ReceivedFileReadError(
                    .invalidRequest,
                    "readReceivedFile needs a JSON object with a string `path`"
                        + " and numeric `offset`/`length`"))
        }
        guard let path = payload.path, !path.isEmpty else {
            return .failure(
                ReceivedFileReadError(
                    .invalidRequest, "readReceivedFile needs a `path`"))
        }
        let offset: Int?
        switch wholeBytes(payload.offset, "offset") {
        case .success(let value): offset = value
        case .failure(let error): return .failure(error)
        }
        let length: Int?
        switch wholeBytes(payload.length, "length") {
        case .success(let value): length = value
        case .failure(let error): return .failure(error)
        }
        return .success(
            ReceivedFileReadPlan(
                path: path, offset: offset ?? 0, length: length))
    }

    /// A byte count has to be a WHOLE number in `Int` range — every range rule
    /// in `readWindow` speaks about integers — so anything else is refused by
    /// its own field name rather than folded into the `path` guard.
    private static func wholeBytes(
        _ value: Double?, _ field: String
    ) -> Result<Int?, ReceivedFileReadError> {
        guard let value else { return .success(nil) }
        guard let whole = Int(exactly: value) else {
            return .failure(
                ReceivedFileReadError(
                    .invalidRequest,
                    "`\(field)` must be a whole number of bytes, not \(value)"))
        }
        return .success(whole)
    }
}

/// The byte range one read will actually cover, after clamping.
public struct ReceivedFileReadWindow: Equatable, Sendable {
    public let offset: Int
    public let length: Int

    public init(offset: Int, length: Int) {
        self.offset = offset
        self.length = length
    }
}

/// One chunk of a received file, as the wire's `ReceivedFileChunk`.
public struct ReceivedFileChunk: Equatable, Sendable {
    public let base64: String
    /// Authoritative: the host clamps, so this — not the requested `length` —
    /// is what a caller adds to `offset` for the next read.
    public let bytes: Int
    public let offset: Int
    public let totalBytes: Int
    public let eof: Bool

    public init(
        base64: String, bytes: Int, offset: Int, totalBytes: Int, eof: Bool
    ) {
        self.base64 = base64
        self.bytes = bytes
        self.offset = offset
        self.totalBytes = totalBytes
        self.eof = eof
    }

    /// The JSON-safe payload the invoke resolves with.
    public func payload() -> [String: Any] {
        [
            "base64": base64,
            "bytes": bytes,
            "offset": offset,
            "totalBytes": totalBytes,
            "eof": eof,
        ]
    }
}
