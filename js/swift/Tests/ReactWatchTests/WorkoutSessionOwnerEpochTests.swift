// WorkoutBridge.swift is watchOS-only (#if os(watchOS) in ReactWatchHost);
// this test compiles to nothing under `swift test` on macOS/Linux and runs
// only on the watchOS simulator via `xcodebuild test`.
#if os(watchOS)
import HealthKit
import XCTest

@testable import ReactWatchHost

/// Regression coverage for the `epoch(of:)` race fixed 2026-08-11 (a326cf4):
/// `workoutSession(_:didChangeTo:...)` and `workoutSession(_:didFailWithError:)`
/// each used to compute `epoch(of: session)` — which reads the mutable
/// `session`/`epoch` properties — BEFORE hopping to `DispatchQueue.main.async`,
/// on whatever thread HealthKit's delegate machinery calls from. That raced
/// every main-queue write to those properties (a `boot()`/`tearDownForReload()`
/// reassignment landing mid-flight could be missed, reading a torn/stale
/// value). The fix moved the read inside the dispatched block, so it happens
/// after the hop, confined to the same queue as every write — mirroring the
/// identical fix already applied to CalendarBridge.
///
/// Same technique as `CapabilityBridgesTests`: a real concurrent race can't be
/// pinned deterministically by a fast XCTest, so this drives the identical
/// defect through a deterministic angle — call the real delegate method
/// synchronously (which enqueues work on the main queue), then synchronously
/// mutate `epoch` right after, still ahead of the queued block draining, and
/// assert which epoch value was actually published. `session` identity is
/// left untouched by that mutation on purpose: `epoch(of:)` gates on
/// `session === self.session`, so keeping identity stable isolates the
/// ordering of the VALUE read from that unrelated identity check.
final class WorkoutSessionOwnerEpochTests: XCTestCase {
    /// With the bug reverted (`epoch(of:)` read BEFORE
    /// `DispatchQueue.main.async` in `workoutSession(_:didChangeTo:...)`),
    /// this fails: `XCTAssertEqual failed: ("[3]") is not equal to ("[4]")` —
    /// the epoch captured at call time (3) is what's published, even though 4
    /// was already current by the time delivery happened.
    @MainActor
    func testDidChangeToReadsEpochAtDeliveryNotAtCallTime() throws {
        let owner = WorkoutSessionOwner()
        let session = try Self.makeSession()
        owner.testOnlySeedLiveSession(session, epoch: 3)

        // `emitState` itself hops via a SECOND `DispatchQueue.main.async` on
        // top of the delegate method's own hop (the one under test), so the
        // wait has to be for `onState` actually firing — a fixed-count
        // "drain the queue" tick (the `CapabilityBridgesTests` shape, which
        // only has one hop) would race ahead of it and observe nothing.
        let received = expectation(description: "onState delivered")
        var observedEpochs: [Int] = []
        owner.onState = { _, _, epoch in
            observedEpochs.append(epoch)
            received.fulfill()
        }

        owner.workoutSession(
            session, didChangeTo: .running, from: .notStarted, date: Date())
        // The boot()/tearDownForReload() reassignment, made deterministic:
        // this runs in the SAME main-actor turn as the delegate call, so the
        // block that call enqueued cannot have run yet — a queued item never
        // preempts the item that queued it, and the queue only advances when
        // `wait(for:)` below yields the turn.
        owner.testOnlySeedLiveSession(session, epoch: 4)

        wait(for: [received], timeout: 1)

        XCTAssertEqual(
            observedEpochs, [4],
            "workoutSession(_:didChangeTo:...) must read epoch(of:) at "
                + "delivery time, not capture it synchronously at the "
                + "delegate call")
    }

    /// Same defect, same fix, same proof for the other delegate entry point.
    @MainActor
    func testDidFailWithErrorReadsEpochAtDeliveryNotAtCallTime() throws {
        let owner = WorkoutSessionOwner()
        let session = try Self.makeSession()
        owner.testOnlySeedLiveSession(session, epoch: 3)

        let received = expectation(description: "onState delivered")
        var observedEpochs: [Int] = []
        owner.onState = { _, _, epoch in
            observedEpochs.append(epoch)
            received.fulfill()
        }

        struct StubError: Error {}
        // Same one-turn framing as the didChangeTo test above.
        owner.workoutSession(session, didFailWithError: StubError())
        owner.testOnlySeedLiveSession(session, epoch: 4)

        wait(for: [received], timeout: 1)

        XCTAssertEqual(
            observedEpochs, [4],
            "workoutSession(_:didFailWithError:) must read epoch(of:) at "
                + "delivery time, not capture it synchronously at the "
                + "delegate call")
    }

    /// A real `HKWorkoutSession` — construction succeeds without the
    /// healthkit entitlement (verified empirically for a326cf4), and
    /// `epoch(of:)`'s `===` identity check needs a real object, not a mock.
    private static func makeSession() throws -> HKWorkoutSession {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .other
        return try HKWorkoutSession(
            healthStore: HKHealthStore(), configuration: configuration)
    }
}
#endif
