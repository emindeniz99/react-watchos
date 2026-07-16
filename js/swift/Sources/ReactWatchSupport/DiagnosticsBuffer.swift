import Foundation

#if canImport(os)
import os
#endif

/// Where diagnostics go besides the ring — the ARCH-13 "pluggable sink".
/// A host that wants fleet telemetry implements this and forwards.
public protocol DiagnosticsSink {
    func emit(_ diagnostic: Diagnostic)
}

/// Bounded ring of the most recent diagnostics. Always on — release builds
/// too — so an OTA rollback in the field leaves forensics behind (the
/// inspector exposure on top of it stays DEV/opt-in). Not thread-safe:
/// confine to one queue/actor (the host uses it on the main actor).
public final class DiagnosticsBuffer {
    public let capacity: Int
    private var entries: [Diagnostic] = []

    public init(capacity: Int = 50) {
        self.capacity = capacity
    }

    public func append(_ diagnostic: Diagnostic) {
        entries.append(diagnostic)
        if entries.count > capacity {
            entries.removeFirst(entries.count - capacity)
        }
    }

    /// Oldest → newest.
    public var all: [Diagnostic] { entries }

    /// The most recent entry of `severity`, if any is still in the ring.
    public func latest(severity: Diagnostic.Severity) -> Diagnostic? {
        entries.last { $0.severity == severity }
    }
}

/// Default sink: one structured line per diagnostic via os.Logger (subsystem
/// `com.reactwatchos.runtime`, category `diagnostics` — same subsystem as the
/// boot/js logs, filterable in Console.app). Linux (no `os`) keeps `print`,
/// matching JSRuntime's log fallback — the tests there read stdout.
public struct LogDiagnosticsSink: DiagnosticsSink, Sendable {
    #if canImport(os)
    private static let log = Logger(
        subsystem: "com.reactwatchos.runtime", category: "diagnostics")
    #endif

    public init() {}

    public func emit(_ diagnostic: Diagnostic) {
        let line =
            "[\(diagnostic.severity.rawValue)] \(diagnostic.code) "
            + "(\(diagnostic.subsystem.rawValue)/\(diagnostic.target.rawValue))"
            + (diagnostic.details.map { ": \($0)" } ?? "")
        #if canImport(os)
        Self.log.notice("\(line, privacy: .public)")
        #else
        print("[diagnostics]", line)
        #endif
    }
}
