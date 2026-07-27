import Foundation

/// Cross-process-atomic integer counters backed by a coordinated file in the
/// App Group container (ARCH-05).
///
/// Why this exists: structured shared state in the App Group is read-modified-
/// written by **two processes** — the watch app and the widget extension. The
/// hydration counter is the live example: the app's "Add glass" button and the
/// extension's `addGlass` control both do `get + 1 + set`. `UserDefaults` (what
/// `SharedWidgetStore` uses for plain key/values) has **no** atomic cross-process
/// read-modify-write, so two concurrent increments both read N and both write
/// N+1 — one increment is silently lost.
///
/// The only primitive that serializes a *whole* read-modify-write across
/// processes on watchOS is an `NSFileCoordinator` write claim: the read, the
/// arithmetic, and the write all run inside one claim against one file URL, so a
/// second process's claim on the same URL blocks until the first completes. A
/// fresh coordinator per op with no `filePresenter` is the documented, deadlock-
/// free shape.
///
/// Foundation-only so it type-checks on Linux (`swift test`). `NSFileCoordinator`
/// isn't in swift-corelibs-foundation, so the Linux path is a plain (un-claimed)
/// file RMW — fine for the single-process unit tests of the clamp/persist logic;
/// real cross-process atomicity is a Darwin-only guarantee, exercised on-device.
public struct CoordinatedCounterStore: Sendable {
    /// Where the `.counter` files live, or nil when sharing is disabled (no App
    /// Group) — then every op is a no-op returning the floor of the range.
    private let directory: URL?

    /// Production: resolve the App Group container (nil disables sharing, like
    /// `SharedWidgetStore`). Counters live in a `counters/` subdirectory so they
    /// never collide with other App Group files. `subdirectory` carves out a
    /// separate namespace for a counter that must not be reachable from JS
    /// (ARCH-06's state revision): keys become file names, so a bundle writing
    /// the same key through `Storage.counterAdd` would otherwise share the file.
    public init(appGroupId: String?, subdirectory: String = "counters") {
        // App Group containers are Darwin-only (no `containerURL` in
        // corelibs-foundation); on Linux — where only the pure logic is under
        // test via init(directory:) — sharing is simply disabled.
        #if canImport(Darwin)
        directory = appGroupId.flatMap {
            FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: $0)?
                .appendingPathComponent(subdirectory, isDirectory: true)
        }
        #else
        directory = nil
        #endif
    }

    /// Custom storage location (tests, or a consumer that wants its own dir).
    public init(directory: URL?) {
        self.directory = directory
    }

    /// Current value of a counter, 0 when unset/unreadable.
    public func value(forKey key: String) -> Int {
        guard let url = fileURL(for: key) else { return 0 }
        return coordinatedRead(url) ?? 0
    }

    /// Atomically add `delta`, clamp the result to `min...max`, persist it, and
    /// return the new value. The read, clamp, and write happen inside one write
    /// claim, so concurrent callers (across processes) can't lose an update.
    ///
    /// Reset-to-floor is expressible as `add(-(max - min) ... , min:, max:)` (or
    /// any delta that underflows `min`) — there's no separate "set" because every
    /// mutation a counter needs is a clamped add.
    @discardableResult
    public func add(_ delta: Int, toKey key: String, min: Int, max: Int) -> Int {
        guard let url = fileURL(for: key) else { return min }
        ensureDirectory(url.deletingLastPathComponent())
        var result = min
        coordinatedWrite(url) { current in
            // Saturate BEFORE clamping: Swift's `+` traps on overflow, so a huge
            // delta or a corrupt/oversized file value would crash the process
            // (both the app and the widget extension run this) instead of
            // bounding to the range. addingReportingOverflow never traps.
            let (sum, overflowed) = (current ?? 0).addingReportingOverflow(delta)
            let saturated = overflowed ? (delta > 0 ? Int.max : Int.min) : sum
            result = Self.clamp(saturated, min: min, max: max)
            return result
        }
        return result
    }

    /// Pure clamp — the arithmetic, unit-tested without any file or coordinator.
    static func clamp(_ value: Int, min: Int, max: Int) -> Int {
        Swift.min(max, Swift.max(min, value))
    }

    // MARK: - Files

    /// File URL for a JS storage key. The key is percent-encoded to a single safe
    /// path component so a key like `a.b/c` can't escape the counters directory.
    private func fileURL(for key: String) -> URL? {
        guard let directory else { return nil }
        let safe =
            key.addingPercentEncoding(
                withAllowedCharacters: .alphanumerics) ?? key
        return directory.appendingPathComponent("\(safe).counter")
    }

    private func ensureDirectory(_ dir: URL) {
        try? FileManager.default.createDirectory(
            at: dir, withIntermediateDirectories: true)
    }

    private func parseInt(_ url: URL) -> Int? {
        guard let data = try? Data(contentsOf: url),
            let text = String(data: data, encoding: .utf8)
        else { return nil }
        return Int(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func writeInt(_ value: Int, to url: URL) {
        try? Data(String(value).utf8).write(to: url, options: .atomic)
    }

    // MARK: - Coordination (Darwin only)

    #if canImport(Darwin)
    private func coordinatedRead(_ url: URL) -> Int? {
        var value: Int?
        var error: NSError?
        NSFileCoordinator().coordinate(
            readingItemAt: url, options: [], error: &error
        ) { value = parseInt($0) }
        return value
    }

    private func coordinatedWrite(_ url: URL, _ mutate: (Int?) -> Int) {
        var error: NSError?
        NSFileCoordinator().coordinate(
            writingItemAt: url, options: [], error: &error
        ) { writeURL in
            writeInt(mutate(parseInt(writeURL)), to: writeURL)
        }
    }
    #else
    // swift-corelibs-foundation has no NSFileCoordinator: a plain file RMW.
    // Single-process only — enough for `swift test`, not cross-process safe.
    private func coordinatedRead(_ url: URL) -> Int? { parseInt(url) }

    private func coordinatedWrite(_ url: URL, _ mutate: (Int?) -> Int) {
        writeInt(mutate(parseInt(url)), to: url)
    }
    #endif
}
