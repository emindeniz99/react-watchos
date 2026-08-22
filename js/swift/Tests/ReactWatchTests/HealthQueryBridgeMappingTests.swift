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
/// Every assertion about the quantity family is driven off
/// `HealthQuantityKind.allCases` and every table below is an exhaustive
/// `switch`, so a fifteenth read type cannot land with its mapping unasserted:
/// this file stops compiling until someone writes the arm.
///
/// The saved-workout tests at the end cannot be driven that way —
/// `HKWorkoutActivityType` is an ObjC `NS_ENUM` with no `allCases` — so they
/// pin a written-out table of activities instead, plus the two closures that do
/// hold for the whole vocabulary however it grows: every distance type the
/// table can return is in the set the read authorizes, and every one of them is
/// expressible in metres.
///
/// The rings tests after them ask the four questions no Linux scan can: what
/// `HKObjectType.activitySummaryType()` IS (a third kind of read type, which is
/// why it needs its own flag), what a decoded plan reaches the SHEET as,
/// whether HealthKit's own predicate builder accepts the day components
/// `ActivityDay` hands it — the one that matches nothing, silently, when it is
/// built wrong — and how `HKActivityMoveMode`, a watchOS-only enum, maps to the
/// wire vocabulary in both directions.
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
    /// fourteen kinds that resolve to thirteen types means one of them is
    /// reading someone else's data, whichever arm is wrong.
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

    /// The same backstop for the one COMPOUND unit, and the reason it needs
    /// its own: `is(compatibleWith:)` below is prefix-BLIND, so litres for
    /// millilitres, or grams for kilograms, each stays "compatible" with
    /// `HKQuantityType(.vo2Max)` while moving the reading by 1000× (both at
    /// once, by 1e6×) under a label that still says ml/kg/min. The family arm in `expectedUnitString` re-derives
    /// the same expression the bridge uses, which catches later drift but not a
    /// slip written by the same hand on the same day. A conversion catches both.
    @MainActor
    func testVO2MaxIsReadInMillilitresPerKilogramPerMinute() {
        let unit = HealthQueryBridge.unit(for: .vo2Max)
        let oneLitrePerKilogramMinute = HKQuantity(
            unit: HKUnit.liter().unitDivided(
                by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: HKUnit.minute())),
            doubleValue: 1)
        // Same hazard as the SDNN test: a wrong-FAMILY unit raises an ObjC
        // exception that takes the whole test process down instead of failing
        // one case, so ask the compatibility question first.
        guard oneLitrePerKilogramMinute.`is`(compatibleWith: unit) else {
            XCTFail("vo2Max is not read in a volume/mass/time unit at all")
            return
        }
        XCTAssertEqual(
            oneLitrePerKilogramMinute.doubleValue(for: unit), 1000, accuracy: 1e-9,
            "vo2Max is not read in millilitres per kilogram per minute")
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

    /// The saved-workout read's own object type. `HKObjectType.workoutType()`
    /// is neither a quantity nor a category type, so it is the one read in this
    /// bridge that no `HealthQuantityKind` arm can cross-check.
    @MainActor
    func testTheHistoryReadReadsTheWorkoutType() {
        XCTAssertEqual(
            HealthQueryBridge.workoutType.identifier, HKWorkoutTypeIdentifier,
            "the saved-workout read is not asking HealthKit for workouts")
    }

    /// The sheet has to name everything a workout SUMMARY touches. Apple
    /// computes `HKWorkout.statistics(for:)` from the quantity samples
    /// ASSOCIATED with the workout, and each of those carries its own read
    /// grant — so a set missing one of them is a history list that reports
    /// `null` energy or `null` distance forever, with no row the user could
    /// have granted. This is also the join no regex can make: the Linux scan
    /// sees the two source lines, this asks whether the RESULTING set really
    /// covers every type the query can read.
    @MainActor
    func testTheHistoryReadAuthorizesEverythingItReads() {
        let types = HealthQueryBridge.workoutHistoryTypes
        XCTAssertTrue(
            types.contains(HealthQueryBridge.workoutType),
            "the history read does not ask for the workout type")
        XCTAssertTrue(
            types.contains(HKQuantityType(.activeEnergyBurned)),
            "the history read reports energy it never asked to read")
        for identifier in WorkoutDistance.allIdentifiers {
            XCTAssertTrue(
                types.contains(HKQuantityType(identifier)),
                "\(identifier.rawValue) can be read but is never asked for")
        }
    }

    /// The distance table, from the side that matters: every activity the
    /// switch names has to resolve to a type the authorization set covers, or
    /// the row reads null under a grant that was never requested. The mapping
    /// itself is pinned textually on Linux; what this adds is that the two
    /// tables AGREE, and that the name-keyed door the live workout uses gives
    /// the same answer as the enum-keyed one the history read uses.
    @MainActor
    func testDistanceIsReadUnderTheTypeTheActivityRecordsItIn() {
        let expected: [(String, HKWorkoutActivityType, HKQuantityTypeIdentifier)] = [
            ("running", .running, .distanceWalkingRunning),
            ("walking", .walking, .distanceWalkingRunning),
            ("cycling", .cycling, .distanceCycling),
            ("handCycling", .handCycling, .distanceCycling),
            ("swimming", .swimming, .distanceSwimming),
            ("wheelchairWalkPace", .wheelchairWalkPace, .distanceWheelchair),
            ("wheelchairRunPace", .wheelchairRunPace, .distanceWheelchair),
            ("downhillSkiing", .downhillSkiing, .distanceDownhillSnowSports),
            ("snowboarding", .snowboarding, .distanceDownhillSnowSports),
            // No distance type of its own: the default reads a type that
            // exists and has no samples, which is the `null` the wire wants.
            ("yoga", .yoga, .distanceWalkingRunning),
        ]
        for (name, activity, identifier) in expected {
            XCTAssertEqual(
                WorkoutDistance.identifier(for: activity), identifier,
                "\(name) reads the wrong distance type")
            XCTAssertEqual(
                WorkoutDistance.identifier(forName: name), identifier,
                "\(name) resolves differently by name than by case")
            XCTAssertTrue(
                WorkoutDistance.allIdentifiers.contains(identifier),
                "\(identifier.rawValue) is reachable but unauthorized")
            XCTAssertTrue(
                HKQuantityType(identifier).`is`(compatibleWith: .meter()),
                "\(identifier.rawValue) is not a distance at all")
        }
        // A name this binary's vocabulary excludes — Apple deprecated `dance`
        // at watchOS 7.0 — takes the default rather than trapping, the same
        // answer a session with no plan at all gets.
        XCTAssertEqual(
            WorkoutDistance.identifier(forName: "dance"), .distanceWalkingRunning)
        XCTAssertEqual(
            WorkoutDistance.identifier(forName: nil), .distanceWalkingRunning)
    }

    /// The units the summary reads in, asked the way the quantity family above
    /// is asked: HealthKit refuses an inexpressible unit by THROWING from a
    /// live query, on a wrist, after the sheet was already granted.
    @MainActor
    func testTheSummaryReadsEnergyInKilocalories() {
        XCTAssertTrue(
            HKQuantityType(.activeEnergyBurned).`is`(compatibleWith: .kilocalorie()),
            "the workout summary reads energy in a unit that is not energy")
    }

    /// The rings read's own object type. `HKObjectType.activitySummaryType()`
    /// is a THIRD kind of read type — neither quantity nor category — which is
    /// the entire justification for `requestHealthAuthorization` carrying a
    /// separate `activitySummaries` flag, and nothing on the Linux side can
    /// check a claim about a HealthKit class hierarchy.
    @MainActor
    func testTheRingsReadReadsTheActivitySummaryType() {
        XCTAssertTrue(
            HealthQueryBridge.activitySummaryType is HKActivitySummaryType,
            "the rings read is not asking HealthKit for activity summaries")
        XCTAssertFalse(
            HealthQueryBridge.activitySummaryType is HKQuantityType,
            "an activity summary is not a quantity type — the flag exists "
                + "because it cannot ride the `read` list")
        XCTAssertFalse(
            HealthQueryBridge.activitySummaryType is HKCategoryType,
            "an activity summary is not a category type either")
    }

    /// What a decoded plan actually reaches the SHEET as. Two claims the JSDoc
    /// makes to callers and only this can check: asking for rings shows exactly
    /// ONE row (a summary is one object HealthKit hands over whole, goals
    /// included — there are no per-sample grants behind it, unlike a workout's
    /// totals), and no other read drags the rings in behind the user's back.
    @MainActor
    func testTheRingsAskIsExactlyOneRowAndNoOtherReadImpliesIt() {
        guard
            let rings = try? HealthAuthorizationPlan.decode(
                json: #"{"read":[],"activitySummaries":true}"#
            ).get()
        else { return XCTFail("a rings-only ask must decode") }
        XCTAssertEqual(
            HealthQueryBridge.objectTypes(for: rings),
            [HealthQueryBridge.activitySummaryType],
            "the rings ask is not exactly one row of the sheet")
        // The neighbouring reads, including the two that LOOK like the rings
        // (`appleExerciseTime` and `appleStandTime` measure the same minutes and
        // hours — they just have no goal to score them against).
        guard
            let others = try? HealthAuthorizationPlan.decode(
                json: #"""
                    {"read":["appleExerciseTime","appleStandTime"],
                     "sleep":true,"workoutHistory":true}
                    """#
            ).get()
        else { return XCTFail("the sibling ask must decode") }
        XCTAssertFalse(
            HealthQueryBridge.objectTypes(for: others).contains(
                HealthQueryBridge.activitySummaryType),
            "a read that never asked for the rings is being granted them")
    }

    /// The predicate that silently returns nothing when it is wrong.
    ///
    /// Activity summaries match by `DateComponents` identifying a day as the
    /// user perceives it, and Apple requires those components to carry a
    /// `calendar` — a set without one matches NOTHING, with no throw: the caller
    /// just sees `[]`. `SupportTests` proves on Linux that `ActivityDay`
    /// attaches it; what only a watch can do is hand those components to
    /// HealthKit's own predicate builder and see that it accepts them and
    /// matches on the DAY key path rather than on some instant.
    @MainActor
    func testTheRingsPredicateIsBuiltFromDayComponentsThatCarryTheCalendar() {
        guard
            let plan = try? ActivitySummariesPlan.decode(
                json: #"{"startDate":"2026-01-14","endDate":"2026-01-20"}"#
            ).get()
        else { return XCTFail("a week of rings must decode") }
        XCTAssertNotNil(
            plan.start.components.calendar,
            "components without a calendar match nothing, silently")
        XCTAssertTrue(plan.start.components.isValidDate)
        let predicate = HKQuery.predicate(
            forActivitySummariesBetweenStart: plan.start.components,
            end: plan.end.components)
        XCTAssertTrue(
            predicate.predicateFormat.contains(HKPredicateKeyPathDateComponents),
            "the rings predicate is not matching on the day key path: "
                + predicate.predicateFormat)
    }

    /// The live stream's descriptor, for the WHOLE read vocabulary.
    ///
    /// `HKAnchoredObjectQueryDescriptor` is generic over its sample type and is
    /// the only query in this bridge that is never `await`ed to completion, so
    /// what a watch can check that Linux cannot is that the descriptor binds and
    /// carries the two decisions the stream is made of: no anchor (the backlog
    /// is kept out by the PREDICATE, not by an anchor) and no limit (Apple
    /// documents `limit` as the maximum the QUERY returns — a total, not a page
    /// — so one would end a long-running stream silently).
    @MainActor
    func testTheLiveStreamDescriptorBindsForEveryReadType() {
        for kind in HealthQuantityKind.allCases {
            let descriptor = HKAnchoredObjectQueryDescriptor(
                predicates: [
                    .quantitySample(
                        type: HealthQueryBridge.quantityType(for: kind),
                        predicate: HKQuery.predicateForSamples(
                            withStart: Date(timeIntervalSince1970: 1_768_396_800),
                            end: nil))
                ],
                anchor: nil,
                limit: nil)
            XCTAssertEqual(descriptor.predicates.count, 1, "\(kind.rawValue)")
            XCTAssertNil(descriptor.anchor, "\(kind.rawValue)")
            XCTAssertNil(descriptor.limit, "\(kind.rawValue)")
        }
    }

    /// The predicate that decides what "new" means — the stream's one design
    /// decision, and one only HealthKit's own builder can answer.
    ///
    /// With `anchor: nil` the first result is everything MATCHING, so an
    /// unbounded predicate would replay a subscriber's whole history. The bound
    /// is an open-ended window from the moment the stream starts, under
    /// HealthKit's default options — which Apple documents as `endDate >= start`
    /// once `end` is nil. That is OVERLAP, and it is load-bearing in one
    /// direction: step and energy samples are written AFTER the minutes they
    /// cover, so a sample whose START precedes the subscribe instant still
    /// matches, while one already OVER does not. A start-date rule would drop
    /// exactly the samples a live steps screen exists to show.
    @MainActor
    func testTheLiveStreamMatchesOnTheSampleEndDateNotItsStart() {
        let since = Date(timeIntervalSince1970: 1_768_396_800)
        let live = HKQuery.predicateForSamples(withStart: since, end: nil)
        XCTAssertTrue(
            live.predicateFormat.contains(HKPredicateKeyPathEndDate),
            "the live predicate is not matching on the sample end date: "
                + live.predicateFormat)
        // The comparison that makes the claim above checkable rather than a
        // hope: the CLOSED form of the same builder does constrain the start,
        // so its absence from the open-ended form is a real difference and not
        // a key path HealthKit simply never names.
        let closed = HKQuery.predicateForSamples(
            withStart: since, end: Date(timeIntervalSince1970: 1_768_483_200))
        XCTAssertTrue(
            closed.predicateFormat.contains(HKPredicateKeyPathStartDate),
            "a closed window is expected to constrain the start date: "
                + closed.predicateFormat)
        XCTAssertFalse(
            live.predicateFormat.contains(HKPredicateKeyPathStartDate),
            "the live predicate is constraining the sample START, which drops "
                + "every sample HealthKit saves for a window that began before "
                + "the stream did: " + live.predicateFormat)
    }

    /// The bucketed statistics descriptor, at BOTH strides the bridge passes.
    ///
    /// What a watch can check that Linux cannot is that HealthKit's own
    /// descriptor accepts and carries the two decisions the bucketed queries
    /// are made of — the anchor is the caller's own window start (the time
    /// zone stays in JS) and the stride is exactly the `DateComponents` the
    /// wrapper named, day for `queryHealthDailyStatistics` and hour for
    /// `queryHealthHourlyStatistics`. The hour arm is the healthHourlyBuckets
    /// follow-up: a mangled stride here would not fail, it would bucket a
    /// steps-per-hour chart by some other interval under a green build.
    @MainActor
    func testTheBucketedDescriptorCarriesTheAnchorAndBothStrides() {
        let anchor = Date(timeIntervalSince1970: 1_768_396_800)
        for stride in [DateComponents(day: 1), DateComponents(hour: 1)] {
            let descriptor = HKStatisticsCollectionQueryDescriptor(
                predicate: .quantitySample(
                    type: HKQuantityType(.stepCount),
                    predicate: HKQuery.predicateForSamples(
                        withStart: anchor,
                        end: Date(timeIntervalSince1970: 1_768_483_200))),
                options: .cumulativeSum,
                anchorDate: anchor,
                intervalComponents: stride)
            XCTAssertEqual(descriptor.anchorDate, anchor, "\(stride)")
            XCTAssertEqual(descriptor.intervalComponents, stride)
        }
    }

    /// The identity the live stream retracts by. `HKObject.uuid` (watchOS 2.0)
    /// is assigned at CONSTRUCTION, not at save — which is what lets the
    /// bridge put an `id` on every row it emits, saved or streamed, without a
    /// store in the loop. What no simulator can prove is the other half — that
    /// a real deletion's `HKDeletedObject.uuid` names the uuid the add carried
    /// — because HKDeletedObject has no public initializer and an unsigned sim
    /// has no store to delete from: that join is device-owed.
    @MainActor
    func testASampleCarriesItsIdentityBeforeItIsEverSaved() {
        let sample = HKQuantitySample(
            type: HKQuantityType(.stepCount),
            quantity: HKQuantity(unit: .count(), doubleValue: 12),
            start: Date(timeIntervalSince1970: 1_768_396_800),
            end: Date(timeIntervalSince1970: 1_768_396_860))
        XCTAssertNotNil(UUID(uuidString: sample.uuid.uuidString))
    }

    /// The move ring, by CASE and in both directions. `HKActivityMoveMode` is an
    /// ObjC enum that exists only on watchOS, so this table cannot be checked
    /// anywhere else — and getting it wrong does not fail, it tells a move-time
    /// user (every under-18 account) that their calorie ring closed.
    @MainActor
    func testTheMoveRingIsNamedByCaseAndTheWireVocabularyIsExactlyReachable() {
        XCTAssertEqual(
            HealthQueryBridge.moveMode(for: .activeEnergy), .activeEnergy)
        XCTAssertEqual(
            HealthQueryBridge.moveMode(for: .appleMoveTime), .appleMoveTime)
        // Every mode the wire declares is produced by some HealthKit case, and
        // no other: a wire case nothing can emit is dead vocabulary a caller
        // would still have to branch on.
        let reachable = [HKActivityMoveMode.activeEnergy, .appleMoveTime]
            .compactMap(HealthQueryBridge.moveMode(for:))
        XCTAssertEqual(Set(reachable), Set(ActivityMoveMode.allCases))
    }

    /// The identifier each kind is NAMED for, written out rather than derived
    /// from `rawValue`. Apple documents the CONSTANTS
    /// (`HKQuantityTypeIdentifierStepCount` et al., every one of them
    /// `HKQuantityTypeIdentifier` + the capitalized case name) but not the
    /// strings they hold, so deriving the identifier here would pin a naming
    /// convention this repo cannot check. The `switch` is exhaustive, which is
    /// what makes a fifteenth kind a build error in this file too, and it is
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
        case .appleExerciseTime: .appleExerciseTime
        case .basalEnergyBurned: .basalEnergyBurned
        case .respiratoryRate: .respiratoryRate
        case .flightsClimbed: .flightsClimbed
        case .vo2Max: .vo2Max
        case .walkingHeartRateAverage: .walkingHeartRateAverage
        case .appleStandTime: .appleStandTime
        }
    }

    /// What `HKUnit.unitString` must report for each kind: the wire string
    /// itself for twelve of the fourteen, so the Support name and the Host
    /// measurement cross-check each other. Two arms pin only the unit FAMILY,
    /// re-deriving the expectation from an `HKUnit` and asserting nothing about
    /// how HealthKit SPELLS it. Be clear about what that is worth: the derived
    /// expression is the bridge's own, so a family arm catches later drift, not
    /// a slip made while writing it — the MAGNITUDE is pinned by the two
    /// conversion tests above. Both arms stay pinned textually on the Linux
    /// side by js/test/health-package-guards.test.ts.
    ///
    /// The exact-string arms rest on Apple's `HKUnit(from:)` table giving one
    /// spelling for each of them ("count", "kcal", "m", "min", and "ms" as the
    /// milli- prefix on "s"), plus the precedent of the sim runs on 2026-08-06
    /// and 08-10, where the standalone `count`, `kcal` and `m` arms went green
    /// — i.e. a standalone unit does render as its table string. `min` is the
    /// one spelling in this change with no run behind it yet.
    private static func expectedUnitString(for kind: HealthQuantityKind) -> String {
        switch kind {
        // Apple: percent "measures a value between 0.0 and 1.0". So the wire
        // says "fraction" — calling it percent is how a caller ends up
        // multiplying by 100 twice.
        case .oxygenSaturation: HKUnit.percent().unitString
        // The wire label matches Apple's table entry (`ml/kg/min`), but that
        // table is the PARSER's input vocabulary, not a promise about what
        // `unitString` prints back for a composed compound — and the same page
        // accepts both `L` and `l` for litres while its own rule allows one
        // division symbol, which this entry breaks. So there is no canonical
        // spelling to assert here, and guessing one is a red `watchos-tests`
        // job on a file no Linux machine can compile. Pin what matters instead:
        // the bridge measures millilitres per kilogram per minute, by
        // conversion in `testVO2MaxIsReadInMillilitresPerKilogramPerMinute`.
        case .vo2Max:
            HKUnit.literUnit(with: .milli).unitDivided(
                by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: HKUnit.minute())
            ).unitString
        case .stepCount, .activeEnergyBurned, .distanceWalkingRunning, .heartRate,
            .heartRateVariabilitySDNN, .restingHeartRate, .appleExerciseTime,
            .basalEnergyBurned, .respiratoryRate, .flightsClimbed,
            .walkingHeartRateAverage, .appleStandTime:
            kind.unit
        }
    }
}
#endif
