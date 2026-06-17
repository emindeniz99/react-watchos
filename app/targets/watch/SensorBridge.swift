import CoreMotion
import Foundation
import HealthKit

/// Live sensor streams for js/src/sensors.ts: heart rate via a HealthKit
/// live workout, motion via CoreMotion. Readings are pushed back through
/// onReading (wired to the native-event channel in WatchApp).
/// NOTE: untested until built with Xcode on macOS; needs HealthKit +
/// motion usage entitlements.
final class SensorBridge: NSObject {
    /// (kind, payload) — payload is JSON-safe (numbers).
    var onReading: ((_ kind: String, _ payload: [String: Any]) -> Void)?

    private let healthStore = HKHealthStore()
    private let motion = CMMotionManager()
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
        default: break
        }
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
        DispatchQueue.main.async { self.onReading?("heartRate", ["bpm": bpm]) }
    }

    func workoutBuilderDidCollectEvent(_ builder: HKLiveWorkoutBuilder) {}
}
