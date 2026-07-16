import Foundation

/// One structured diagnostic event (ARCH-13). Replaces the last-write-wins
/// `runtimeError`/`startupError` strings so a fatal startup failure, a
/// transient command failure, a wire incompatibility, an OTA rollback and a
/// budget breach are distinguishable — and machine-readable for fleet
/// telemetry.
///
/// Lives in ReactWatchSupport, not ReactWatchCore: Core's WireModel.swift is
/// @generated (codegen-owned), so a hand-written record can't join the wire
/// package without forking the generator.
// TODO(codegen): fold into codegen/schema.ts when the toolchain is available,
// so js/src/diagnostics.ts's `Diagnostic` type can't drift from this one.
public struct Diagnostic: Codable, Sendable, Equatable {
    public enum Severity: String, Codable, Sendable {
        /// Boot cannot proceed / the UI is unusable — drives the full-screen
        /// error path.
        case fatal
        /// The app keeps running — surfaced as the dismissible banner.
        case recoverable
        /// Forensics only — recorded, never surfaced in UI.
        case info
    }

    public enum Subsystem: String, Codable, Sendable {
        case boot, ota, wire, commit, js, capability, budget, connectivity
    }

    /// Which embedding emitted this (the widget extension is its own process).
    public enum Target: String, Codable, Sendable {
        case watch, widget
    }

    /// Stable machine code, dot-namespaced by subsystem
    /// (e.g. `ota.saveRejected`, `budget.maxNodes`).
    public let code: String
    public let severity: Severity
    public let subsystem: Subsystem
    /// Fresh UUID per runtime boot — correlates diagnostics from one JS
    /// generation across the ring.
    public let sessionId: String
    /// Content hash of the booted bundle (CX-025 releaseId); nil before a
    /// bundle loaded or for a DEBUG dev-code boot.
    public let releaseId: String?
    public let target: Target
    /// Epoch milliseconds.
    public let timestamp: Double
    /// What the user can do about it. Reserved — nil in v1.
    public let userAction: String?
    /// Human-readable message (what the old error string carried).
    public let details: String?

    public init(
        code: String, severity: Severity, subsystem: Subsystem,
        sessionId: String, releaseId: String? = nil, target: Target,
        timestamp: Double = Date().timeIntervalSince1970 * 1000,
        userAction: String? = nil, details: String? = nil
    ) {
        self.code = code
        self.severity = severity
        self.subsystem = subsystem
        self.sessionId = sessionId
        self.releaseId = releaseId
        self.target = target
        self.timestamp = timestamp
        self.userAction = userAction
        self.details = details
    }

    /// Display string for user-facing surfaces (the banner / full-screen
    /// error): the human message when there is one, else the machine code.
    public var message: String { details ?? code }
}
