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

    private struct Op: Decodable {
        let op: String
        let kind: String
    }

    func handleOp(_ json: String) {
        guard let op = try? JSONDecoder().decode(Op.self, from: Data(json.utf8))
        else { return }
        switch (op.op, op.kind) {
        case ("start", "heartRate"): startHeartRate()
        case ("stop", "heartRate"): stopHeartRate()
        case ("start", "motion"): startMotion()
        case ("stop", "motion"): stopMotion()
        case ("start", "gyroscope"): startGyroscope()
        case ("stop", "gyroscope"): motion.stopGyroUpdates()
        case ("start", "location"): startLocation()
        case ("stop", "location"): location.stopUpdatingLocation()
        default: break
        }
    }

    // MARK: - Gyroscope / location

    private func startGyroscope() {
        guard motion.isGyroAvailable else { return }
        motion.gyroUpdateInterval = 0.1
        motion.startGyroUpdates(to: .main) { [weak self] data, _ in
            guard let r = data?.rotationRate else { return }
            self?.onReading?("gyroscope", ["x": r.x, "y": r.y, "z": r.z])
        }
    }

    private func startLocation() {
        location.requestWhenInUseAuthorization()
        location.startUpdatingLocation()
    }

    func locationManager(
        _ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]
    ) {
        guard let loc = locations.last else { return }
        onReading?("location", [
            "latitude": loc.coordinate.latitude,
            "longitude": loc.coordinate.longitude,
            "speed": loc.speed,
            "course": loc.course,
        ])
    }

    // MARK: - Heart rate (HealthKit live workout)

    private func startHeartRate() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let hrType = HKQuantityType(.heartRate)
        healthStore.requestAuthorization(toShare: [], read: [hrType]) { [weak self] ok, _ in
            guard ok, let self else { return }
            DispatchQueue.main.async { self.beginWorkout() }
        }
    }

    private func beginWorkout() {
        let config = HKWorkoutConfiguration()
        config.activityType = .other
        do {
            let session = try HKWorkoutSession(
                healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore, workoutConfiguration: config)
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
        workoutSession?.end()
        workoutBuilder?.endCollection(withEnd: Date()) { _, _ in }
        workoutSession = nil
        workoutBuilder = nil
    }

    // MARK: - Motion (CoreMotion)

    private func startMotion() {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 0.1
        motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
            guard let self, let a = data?.userAcceleration else { return }
            self.onReading?("motion", ["x": a.x, "y": a.y, "z": a.z])
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

    func workoutBuilderDidCollectEvent(_ builder: HKLiveWorkoutBuilder) {}
}
#endif
