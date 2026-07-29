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
///
/// Heart rate no longer OWNS a workout session: watchOS allows one per process
/// and a second start kills the first, so `WorkoutSessionOwner` is the single
/// construction site and this bridge takes a `.heartRate` claim on it (see
/// WorkoutBridge.swift). From JS's side `startHeartRate` is unchanged — the
/// desired-state latch, the auth-window guard and the background backstop all
/// still live here; only the session moved.
/// NOTE: untested until built with Xcode on macOS; needs HealthKit +
/// motion + location usage entitlements.
final class SensorBridge: NSObject, CLLocationManagerDelegate {
    /// (kind, payload) — payload is JSON-safe (numbers).
    var onReading: ((_ kind: String, _ payload: [String: Any]) -> Void)?
    /// The RAW fixes, for the workout owner's HKWorkoutRouteBuilder. A second
    /// CLLocationManager would double the GPS duty cycle for the same data, so
    /// the route rides this stream (Apple discourages a direct route-builder
    /// init for the same "use the one you have" reason).
    var onLocationFix: (([CLLocation]) -> Void)?
    /// The single owner of this process's HKWorkoutSession. Injected rather
    /// than constructed here: the explicit workout API holds the same object.
    var workoutOwner: WorkoutSessionOwner?

    /// Only ever used to run the heart-rate READ authorization sheet. The
    /// session itself belongs to the owner, which has its own store (and asks
    /// for the SHARE grant this one must never want).
    private let healthStore = HKHealthStore()
    private let motion = CMMotionManager()
    /// CMPedometer lives in its own bridge (PedometerBridge.swift) because it
    /// serves BOTH carriers — this push stream and the `queryPedometer` invoke —
    /// and the invoke handler needs to reach it directly.
    let pedometer = PedometerBridge()
    private lazy var location: CLLocationManager = {
        let m = CLLocationManager()
        m.delegate = self
        return m
    }()

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
    /// this flags — never a blind claim while auth is still pending (a session
    /// begun pre-authorization can occupy the slot dead). A pause that ended
    /// NOTHING (because an explicit workout pinned the session) leaves it
    /// false, so the resume can't restart over a live workout.
    private var heartRatePendingRestart = false
    /// Whether JS asked for the location stream, kept apart from route
    /// tracking so ending a workout can't stop a `startLocation` subscription
    /// the app still holds (and vice versa).
    private var jsWantsLocation = false
    /// Whether the live workout is recording a route through this stream.
    private var routeTracking = false

    private struct Op: Decodable {
        let op: String
        let kind: String
        let keepAliveInBackground: Bool?
        let updateIntervalMs: Double?
        let accuracy: String?
        let distanceFilterMeters: Double?
        let fromMs: Double?
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
            jsWantsLocation = true
            startLocation(
                accuracy: op.accuracy,
                distanceFilterMeters: op.distanceFilterMeters)
        case ("stop", "location"):
            jsWantsLocation = false
            stopLocationIfIdle()
        case ("start", "pedometer"): pedometer.start(fromMs: op.fromMs)
        case ("stop", "pedometer"): pedometer.stop()
        // `default` is a forward-compat no-op for an unknown kind, which is
        // exactly why widening SensorKind in JS without adding the case here
        // would silently start nothing forever — the hazard the
        // `_unknownSensorKindIsATypeError` compile guard exists for.
        default: break
        }
    }

    /// Stops every active stream — called on runtime reload (CX-008) so a stale
    /// subscription from the previous generation can't keep the hardware running
    /// or push readings into the fresh runtime, which never subscribed.
    func stopAll() {
        stopHeartRate()
        stopMotion()
        pedometer.stop()
        motion.stopGyroUpdates()
        jsWantsLocation = false
        routeTracking = false
        location.stopUpdatingLocation()
    }

    /// scenePhase -> .background backstop (P0-3). The workout session is what
    /// keeps the app alive (and the HR sensor sampling) after backgrounding.
    /// Motion/gyro/location don't keep the app alive and stop on suspension on
    /// their own, so they're left running. A backgrounded app isn't unmounted,
    /// so JS effect cleanups never fire — native owns this.
    ///
    /// The decision itself belongs to the OWNER, which is the only place that
    /// can see both claims: it ends the session only when the sole claim is the
    /// heart-rate pump and `keepAliveInBackground` is false. An explicit workout
    /// PINS it — that is the entire point of a workout — so this reads as one
    /// rule rather than a second flag parallel to `keepAlive`. The returned
    /// bool says whether anything was actually ended, which is exactly what the
    /// resume needs: a pause that ended nothing must not "restore" a pump over
    /// a live workout.
    func pauseForBackground() {
        isBackgrounded = true
        heartRatePendingRestart =
            workoutOwner?.pauseForBackground(keepAlive: heartRateKeepAlive)
            ?? false
    }

    /// scenePhase -> .active: restart exactly what the background pause (or a
    /// background-deferred auth completion) put on hold.
    func resumeFromForeground() {
        isBackgrounded = false
        guard wantHeartRate, heartRatePendingRestart else { return }
        heartRatePendingRestart = false
        workoutOwner?.claimHeartRate()
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

    /// Route recording rides the SAME manager the JS stream uses. Called by the
    /// workout owner's start/end, never by JS.
    func startRouteTracking() {
        routeTracking = true
        // Best accuracy for a route: a 10 m filter (the JS default) would draw
        // a route out of a dozen points. A JS `startLocation` already running
        // keeps its own tuning — this only raises it for the workout.
        location.requestWhenInUseAuthorization()
        location.desiredAccuracy = kCLLocationAccuracyBest
        location.distanceFilter = kCLDistanceFilterNone
        location.startUpdatingLocation()
    }

    func stopRouteTracking() {
        routeTracking = false
        stopLocationIfIdle()
    }

    /// Stops the GPS only when neither carrier wants it — a workout ending must
    /// not silently kill an app's own `startLocation` subscription.
    private func stopLocationIfIdle() {
        guard !jsWantsLocation, !routeTracking else { return }
        location.stopUpdatingLocation()
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
        if routeTracking { onLocationFix?(locations) }
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

    // MARK: - Heart rate (a claim on the shared workout session)

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
                this.workoutOwner?.claimHeartRate()
            }
        }
    }

    private func stopHeartRate() {
        wantHeartRate = false
        heartRatePendingRestart = false
        // Releases the claim; the owner keeps the session alive if an explicit
        // workout still claims it.
        workoutOwner?.releaseHeartRate()
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
#endif
