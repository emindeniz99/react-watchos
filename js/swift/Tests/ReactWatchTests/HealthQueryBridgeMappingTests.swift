// HealthQueryBridge is watchOS-only (#if os(watchOS) in ReactWatchHost); this
// test compiles to nothing under `swift test` on macOS/Linux and runs only on
// the watchOS simulator via `xcodebuild test`.
//
// js/test/health-package-guards.test.ts already regex-scans both switches for
// an arm per declared kind and for an arm that SPELLS the identifier it is
// named for, so on that identifier axis the Linux scan is as strong as this
// file — it stays, and it stays the early warning. What a regex cannot ask, and
// what this file is here for, is what the arms MEAN: whether the unit an arm
// reads with is even expressible for the type it reads, whether HealthKit's own
// cumulative/discrete verdict matches the one `HealthStatistic.isLegal(for:)`
// refuses requests on, and what a unit MEASURES rather than how it is spelled.
#if os(watchOS)
import HealthKit
import ReactWatchSupport
import XCTest

@testable import ReactWatchHost

/// The Support side NAMES a read type and its unit; this bridge MEASURES them.
/// The two compile independently, so a mismatch ships a chart that LIES rather
/// than failing a build — which is why every pair is pinned here.
///
/// Every assertion is driven off `HealthQuantityKind.allCases` and every table
/// below is an exhaustive `switch`, so an eighth read type cannot land with its
/// mapping unasserted: this file stops compiling until someone writes the arm.
///
/// The `@MainActor` on each test is load-bearing, not decoration:
/// `HealthQueryBridge` is a `@MainActor` class, which isolates its statics too,
/// so in Swift 6 mode calling one from a synchronous nonisolated context is a
/// compile error — the mirror image of the lesson in `NotificationPermissionTests`.
///
/// Nothing here touches an `HKHealthStore` or the authorization sheet.
/// `HKQuantityType`, `HKUnit` and `HKQuantity` are all constructible and
/// interrogable in an unsigned simulator, which is what the `watchos-tests` job
/// runs — a test that needed a granted READ would be untestable there, and
/// HealthKit does not report read grants anyway.
final class HealthQueryBridgeMappingTests: XCTestCase {
    /// The identifier axis, decided by HealthKit instead of by a regex over the
    /// source: `case .restingHeartRate: HKQuantityType(.heartRate)` — what a
    /// duplicated arm produces — compiles, and ships instantaneous heart rate
    /// under a resting-heart-rate label. The Linux scan catches that same slip
    /// textually; this reads the compiled artifact, so it also survives a
    /// reformat the regex would not.
    @MainActor
    func testEveryKindReadsTheTypeItIsNamedFor() {
        for kind in HealthQuantityKind.allCases {
            XCTAssertEqual(
                HealthQueryBridge.quantityType(for: kind).identifier,
                HKQuantityType(Self.identifier(for: kind)).identifier,
                "\(kind.rawValue) does not read the HealthKit type it is named for")
        }
    }

    /// The same slip from the other side, and the half that needs no table:
    /// seven kinds that resolve to six types means one of them is reading
    /// someone else's data, whichever arm is wrong.
    @MainActor
    func testNoTwoKindsReadTheSameType() {
        let identifiers = HealthQuantityKind.allCases.map {
            HealthQueryBridge.quantityType(for: $0).identifier
        }
        XCTAssertEqual(
            Set(identifiers).count, HealthQuantityKind.allCases.count,
            "two read types resolve to the same HKQuantityType: \(identifiers)")
    }

    /// The wire label a caller renders a chart with has to be the unit the
    /// value was actually measured in.
    @MainActor
    func testEveryKindMeasuresInTheUnitTheWireStringNames() {
        for kind in HealthQuantityKind.allCases {
            XCTAssertEqual(
                HealthQueryBridge.unit(for: kind).unitString,
                Self.expectedUnitString(for: kind),
                "\(kind.rawValue) is not measured in the unit it reports")
        }
    }

    /// The backstop for the test above, and the load-bearing one: Apple
    /// documents no table of canonical `unitString` spellings, so a name check
    /// alone rests on "ms" being how HealthKit spells a millisecond. This
    /// asserts by CONVERSION instead. SDNN runs in the tens of milliseconds, so
    /// `HKUnit.second()` in the bridge type-checks, ships, and reports 0.045
    /// where the Health app shows 45 — under a label that still says "ms".
    @MainActor
    func testSDNNIsReadInMillisecondsNotSeconds() {
        let unit = HealthQueryBridge.unit(for: .heartRateVariabilitySDNN)
        let oneSecond = HKQuantity(unit: .second(), doubleValue: 1)
        // `doubleValue(for:)` on a unit from another family raises an ObjC
        // exception, which takes the whole `xcodebuild test` process down
        // instead of failing one case. The neighbouring slip — a unit that is
        // not a time unit at all — has to fail as an assertion, so ask the
        // check Apple's own `doubleValue(for:)` documentation points at first.
        guard oneSecond.`is`(compatibleWith: unit) else {
            XCTFail("heartRateVariabilitySDNN is not read in a time unit at all")
            return
        }
        XCTAssertEqual(
            oneSecond.doubleValue(for: unit), 1000, accuracy: 1e-9,
            "heartRateVariabilitySDNN is not read in milliseconds")
    }

    /// HealthKit refuses a unit its type cannot express, and the refusal is a
    /// THROW from a live query — a runtime failure on a wrist, after a
    /// permission sheet the user already granted. `is(compatibleWith:)` asks the
    /// same question for free, with no store and no authorization.
    @MainActor
    func testEveryUnitIsCompatibleWithTheTypeItReads() {
        for kind in HealthQuantityKind.allCases {
            let type = HealthQueryBridge.quantityType(for: kind)
            XCTAssertTrue(
                type.`is`(compatibleWith: HealthQueryBridge.unit(for: kind)),
                "\(kind.rawValue) reads \(type.identifier) in an incompatible unit")
        }
    }

    /// `HealthQuantityKind.isCumulative` is a hand-written table that Linux can
    /// only prove self-consistent, and it is the axis `HealthStatistic
    /// .isLegal(for:)` gates `.sum` on. HealthKit knows the real answer:
    /// disagree with it and either a legal request throws mid-query, or a
    /// perfectly valid `sum` is refused up front with a message blaming Apple's
    /// matrix. The private `options(for:)` table maps a STATISTIC to its
    /// `HKStatisticsOptions` and is a separate, still-uncovered surface.
    @MainActor
    func testHealthKitAgreesWithTheCumulativeAxisTheStatisticRuleUses() {
        for kind in HealthQuantityKind.allCases {
            let type = HealthQueryBridge.quantityType(for: kind)
            XCTAssertEqual(
                type.aggregationStyle == .cumulative, kind.isCumulative,
                "\(kind.rawValue) disagrees with HealthKit about being cumulative")
        }
    }

    /// The identifier each kind is NAMED for, written out rather than derived
    /// from `rawValue`. Apple documents the CONSTANTS
    /// (`HKQuantityTypeIdentifierStepCount` et al., every one of them
    /// `HKQuantityTypeIdentifier` + the capitalized case name) but not the
    /// strings they hold, so deriving the identifier here would pin a naming
    /// convention this repo cannot check. The `switch` is exhaustive, which is
    /// what makes an eighth kind a build error in this file too, and it is
    /// written from the case names rather than copied from the bridge — the
    /// point is that two independent hands agree.
    private static func identifier(
        for kind: HealthQuantityKind
    ) -> HKQuantityTypeIdentifier {
        switch kind {
        case .stepCount: .stepCount
        case .activeEnergyBurned: .activeEnergyBurned
        case .distanceWalkingRunning: .distanceWalkingRunning
        case .heartRate: .heartRate
        case .oxygenSaturation: .oxygenSaturation
        case .heartRateVariabilitySDNN: .heartRateVariabilitySDNN
        case .restingHeartRate: .restingHeartRate
        }
    }

    /// What `HKUnit.unitString` must report for each kind: the wire string
    /// itself for six of the seven, so the Support name and the Host
    /// measurement cross-check each other. The `oxygenSaturation` arm pins only
    /// the unit FAMILY — its wire label deliberately is not HealthKit's own
    /// spelling, and stays pinned textually on the Linux side by
    /// js/test/health-package-guards.test.ts.
    private static func expectedUnitString(for kind: HealthQuantityKind) -> String {
        switch kind {
        // Apple: percent "measures a value between 0.0 and 1.0". So the wire
        // says "fraction" — calling it percent is how a caller ends up
        // multiplying by 100 twice.
        case .oxygenSaturation: HKUnit.percent().unitString
        case .stepCount, .activeEnergyBurned, .distanceWalkingRunning, .heartRate,
            .heartRateVariabilitySDNN, .restingHeartRate:
            kind.unit
        }
    }
}
#endif
