// watchOS-only host (WatchKit/UIKit/HealthKit/SwiftUI). The #if compiles this
// file to an empty module off-watchOS so `swift test` runs on macOS — see Package.swift.
#if os(watchOS)
import CoreLocation
import CoreMotion
import Foundation
import HealthKit

/// Live sensor streams for js/src/sensors.ts: heart rate via a HealthKit
/// live workout, motion/gyroscope via CoreMotion, location via CoreLocation.
/// Readings are pushed back through onReading (wired to the native-event
/// channel in WatchApp).
/// NOTE: untested until built with Xcode on macOS; needs HealthKit +
/// motion + location usage entitlements.
final class SensorBridge: NSObject, CLLocationManagerDelegate {
    /// (kind, payload) — payload is JSON-safe (numbers).
    var onReading: ((_ kind: String, _ payload: [String: Any]) -> Void)?

    private let healthStore = HKHealthStore()
    private let motion = CMMotionManager()
    private lazy var location: CLLocationManager = {
        let m = CLLocationManager()
        m.delegate = self
        return m
    }()

    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?
    /// Desired-state latch for heart rate. requestAuthorization resolves
    /// asynchronously; if a stop/unmount (or reload via stopAll) lands during
    /// that window, this flips false so the completion doesn't start an orphaned
    /// workout session that drains battery and pushes readings into a runtime
    /// that no longer wants them.
    private var wantHeartRate = false
    /// Whether heart rate should keep running when the app backgrounds (opt-in
    /// from `startHeartRate` options). Default false: `pauseForBackground` ends
    /// the workout session so the app can suspend instead of draining forever.
    private var heartRateKeepAlive = false
    /// scenePhase mirror (P0-3): the auth completion must not START a workout
    /// while backgrounded — the session would keep the app alive draining HR
    /// until the next foreground.
    private var isBackgrounded = false
    /// Set when the background pause ended a live session, or when an auth
    /// completion was deferred by backgrounding. Resume restarts only what
    /// this flags — never a blind beginWorkout while auth is still pending
    /// (a session begun pre-authorization can occupy the slot dead).
    private var heartRatePendingRestart = false

    private struct Op: Decodable {
        let op: String
        let kind: String
        let keepAliveInBackground: Bool?
        let updateIntervalMs: Double?
        let accuracy: String?
        let distanceFilterMeters: Double?
    }

    func handleOp(_ json: String) {
        guard let op = try? JSONDecoder().decode(Op.self, from: Data(json.utf8))
        else { return }
        switch (op.op, op.kind) {
        case ("start", "heartRate"):
            startHeartRate(keepAliveInBackground: op.keepAliveInBackground ?? false)
        case ("stop", "heartRate"): stopHeartRate()
        case ("start", "motion"): startMotion(intervalMs: op.updateIntervalMs)
        case ("stop", "motion"): stopMotion()
        case ("start", "gyroscope"): startGyroscope(intervalMs: op.updateIntervalMs)
        case ("stop", "gyroscope"): motion.stopGyroUpdates()
        case ("start", "location"):
            startLocation(
                accuracy: op.accuracy,
                distanceFilterMeters: op.distanceFilterMeters)
        case ("stop", "location"): location.stopUpdatingLocation()
        default: break
        }
    }

    /// Stops every active stream — called on runtime reload (CX-008) so a stale
    /// subscription from the previous generation can't keep the hardware running
    /// or push readings into the fresh runtime, which never subscribed.
    func stopAll() {
        stopHeartRate()
        stopMotion()
        motion.stopGyroUpdates()
        location.stopUpdatingLocation()
    }

    /// scenePhase -> .background backstop (P0-3). The HealthKit live-workout
    /// session is what keeps the app alive (and the HR sensor sampling) after
    /// backgrounding; end it unless the app opted into background HR, so the app
    /// can suspend normally. Motion/gyro/location don't keep the app alive and
    /// stop on suspension on their own, so they're left running. A backgrounded
    /// app isn't unmounted, so JS effect cleanups never fire — native owns this.
    func pauseForBackground() {
        isBackgrounded = true
        guard !heartRateKeepAlive else { return }
        // Keeps wantHeartRate; the flag tells resume there is a live stream to
        // restore (vs. an auth still pending, which must not be blind-begun).
        if workoutSession != nil { heartRatePendingRestart = true }
        endWorkoutSession()
    }

    /// scenePhase -> .active: restart exactly what the background pause (or a
    /// background-deferred auth completion) put on hold.
    func resumeFromForeground() {
        isBackgrounded = false
        if wantHeartRate, heartRatePendingRestart, workoutSession == nil {
            heartRatePendingRestart = false
            beginWorkout()
        }
    }

    deinit {
        // A discarded bridge must not leak the daemon-owned HKWorkoutSession —
        // the ONE stream that outlives its manager (CMMotionManager and
        // CLLocationManager stop on dealloc by themselves). Deliberately NOT
        // stopAll(): `location` is a lazy var, and touching it here would
        // instantiate a CLLocationManager mid-deinit and hand it a deallocating
        // delegate.
        endWorkoutSession()
    }

    // MARK: - Gyroscope / location

    /// JS-tunable update period (P2): every reading crosses the bridge and can
    /// commit a render, so the period is a direct battery knob. Floor 20ms —
    /// CoreMotion won't deliver meaningfully faster on-watch and a 0 would ask
    /// for max-rate sampling.
    private static func motionInterval(_ intervalMs: Double?) -> TimeInterval {
        max(0.02, (intervalMs ?? 100) / 1000)
    }

    private func startGyroscope(intervalMs: Double? = nil) {
        guard motion.isGyroAvailable else { return }
        motion.gyroUpdateInterval = Self.motionInterval(intervalMs)
        motion.startGyroUpdates(to: .main) { [weak self] data, _ in
            guard let r = data?.rotationRate else { return }
            self?.onReading?("gyroscope", ["x": r.x, "y": r.y, "z": r.z])
        }
    }

    private func startLocation(
        accuracy: String?, distanceFilterMeters: Double?
    ) {
        location.requestWhenInUseAuthorization()
        // Battery-sane defaults (P1-11): the CLLocationManager defaults are
        // kCLLocationAccuracyBest + no distance filter — full GPS engagement
        // with a callback (→ bridge → JS) on every micro-movement. Default to
        // ten-meter accuracy with a 10m filter; apps that genuinely need
        // navigation-grade fixes opt in via startLocation options.
        location.desiredAccuracy = Self.clAccuracy(accuracy)
        location.distanceFilter = distanceFilterMeters ?? 10
        location.startUpdatingLocation()
    }

    private static func clAccuracy(_ name: String?) -> CLLocationAccuracy {
        switch name {
        case "navigation": kCLLocationAccuracyBestForNavigation
        case "best": kCLLocationAccuracyBest
        case "hundredMeters": kCLLocationAccuracyHundredMeters
        case "kilometer": kCLLocationAccuracyKilometer
        default: kCLLocationAccuracyNearestTenMeters
        }
    }

    func locationManager(
        _: CLLocationManager, didUpdateLocations locations: [CLLocation]
    ) {
        guard let loc = locations.last else { return }
        onReading?(
            "location",
            [
                "latitude": loc.coordinate.latitude,
                "longitude": loc.coordinate.longitude,
                "speed": loc.speed,
                "course": loc.course,
            ])
    }

    // MARK: - Heart rate (HealthKit live workout)

    private func startHeartRate(keepAliveInBackground: Bool = false) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        wantHeartRate = true
        heartRateKeepAlive = keepAliveInBackground
        let hrType = HKQuantityType(.heartRate)
        healthStore.requestAuthorization(toShare: [], read: [hrType]) { [weak self] ok, _ in
            guard ok, let self else { return }
            // SensorBridge isn't Sendable, so hop to main without sending self —
            // the same nonisolated(unsafe) idiom this file uses for the off-main
            // HealthKit reading callback (Swift 6 strict concurrency).
            nonisolated(unsafe) let this = self
            DispatchQueue.main.async {
                // Dropped if heart rate was stopped/reloaded during the auth window.
                guard this.wantHeartRate else { return }
                // Backgrounded during the auth window (non-keepAlive): starting
                // now would revive the exact background drain P0-3 removes.
                // Defer to the next foreground via the restart flag instead.
                if this.isBackgrounded, !this.heartRateKeepAlive {
                    this.heartRatePendingRestart = true
                    return
                }
                this.beginWorkout()
            }
        }
    }

    private func beginWorkout() {
        // Idempotent: a second auth completion (e.g. start→reload→start) must not
        // start a second session and leak the first.
        guard workoutSession == nil else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .other
        do {
            let session = try HKWorkoutSession(
                healthStore: healthStore, configuration: config
            )
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore, workoutConfiguration: config
            )
            builder.delegate = self
            workoutSession = session
            workoutBuilder = builder
            session.startActivity(with: Date())
            builder.beginCollection(withStart: Date()) { _, _ in }
        } catch {
            // Heart rate unavailable; silently no-op.
        }
    }

    private func stopHeartRate() {
        wantHeartRate = false
        heartRatePendingRestart = false
        endWorkoutSession()
    }

    /// End the live workout session (releasing its background keep-alive and the
    /// HR sensor) without touching `wantHeartRate` — shared by `stopHeartRate`
    /// and the background pause, which keeps the intent so it can resume.
    private func endWorkoutSession() {
        workoutSession?.end()
        workoutBuilder?.endCollection(withEnd: Date()) { _, _ in }
        workoutSession = nil
        workoutBuilder = nil
    }

    // MARK: - Motion (CoreMotion)

    private func startMotion(intervalMs: Double? = nil) {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = Self.motionInterval(intervalMs)
        motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
            guard let self, let a = data?.userAcceleration else { return }
            onReading?("motion", ["x": a.x, "y": a.y, "z": a.z])
        }
    }

    private func stopMotion() {
        motion.stopDeviceMotionUpdates()
    }
}

extension SensorBridge: HKLiveWorkoutBuilderDelegate {
    func workoutBuilder(
        _ builder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        guard collectedTypes.contains(HKQuantityType(.heartRate)),
            let stats = builder.statistics(for: HKQuantityType(.heartRate)),
            let bpm = stats.mostRecentQuantity()?
                .doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        else { return }
        // Workout-builder callbacks arrive off the main queue; hop to main
        // without sending `self` (Swift 6 strict concurrency).
        nonisolated(unsafe) let handler = onReading
        DispatchQueue.main.async { handler?("heartRate", ["bpm": bpm]) }
    }

    func workoutBuilderDidCollectEvent(_: HKLiveWorkoutBuilder) {}
}
#endif
