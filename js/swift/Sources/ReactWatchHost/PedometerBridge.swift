// CMPedometer: the live `sensor.pedometer` stream and the historical
// `queryPedometer` invoke. watchOS-only, like the rest of ReactWatchHost.
//
// The split follows the rule js/src/invoke.ts already states: "Streaming ops
// (sensor/BLE notifications) keep the push channel" — so live updates ride the
// existing `sensor` channel and only the fallible historical query is an
// invoke. Both carry the SAME `PedometerData` shape (ReactWatchSupport's
// PedometerReading), because they describe the same thing at different times.
#if os(watchOS)
import CoreMotion
import Foundation
import ReactWatchSupport

final class PedometerBridge {
    /// One reading, JSON-safe. Wired to `sensor.pedometer` for the live stream.
    var onReading: (([String: Any]) -> Void)?

    private let pedometer = CMPedometer()
    private var streaming = false

    /// Apple, CMPedometer: "To use this API, you must include the
    /// [NSMotionUsageDescription] key in your app's Info.plist file and provide
    /// a usage description string... **If you don't include a usage description
    /// string, your app crashes when you call this API.**"
    ///
    /// So this is not speculative error handling (rule 2) — it is the documented
    /// consequence of a missing plist key, and the config plugin makes it likely
    /// by keeping `motion` an explicit opt-in. Checking the key turns a
    /// documented CRASH into an actionable UNAVAILABLE.
    static var usageDescriptionMissing: Bool {
        Bundle.main.object(forInfoDictionaryKey: "NSMotionUsageDescription") == nil
    }

    static let missingUsageDescriptionMessage =
        "CoreMotion needs NSMotionUsageDescription in the watch target's "
        + "Info.plist — set `motion: true` in the react-watchos config plugin "
        + "options (calling CMPedometer without it crashes the app)"

    /// Live step/distance/floor/pace updates from `fromMs` (default: now).
    /// Silent no-ops on an unusable configuration match the other sensor
    /// streams (`startGyroscope` guards `isGyroAvailable` the same way); the
    /// actionable message is on the invoke path, which has somewhere to put it.
    func start(fromMs: Double?) {
        guard !streaming, !Self.usageDescriptionMissing,
            CMPedometer.isStepCountingAvailable()
        else { return }
        streaming = true
        let from =
            fromMs.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
        nonisolated(unsafe) let this = self
        pedometer.startUpdates(from: from) { data, _ in
            guard let data else { return }
            let payload = Self.reading(from: data, live: true).payload()
            DispatchQueue.main.async { this.onReading?(payload) }
        }
    }

    func stop() {
        guard streaming else { return }
        streaming = false
        pedometer.stopUpdates()
    }

    /// The historical query (~7 days of on-device history). `nil` = the crash
    /// guard refused; the caller turns that into UNAVAILABLE.
    func query(
        _ plan: PedometerQueryPlan,
        completion: @escaping ([String: Any]?) -> Void
    ) -> Bool {
        guard !Self.usageDescriptionMissing else { return false }
        guard CMPedometer.isStepCountingAvailable() else { return false }
        nonisolated(unsafe) let settle = completion
        pedometer.queryPedometerData(from: plan.start, to: plan.end) { data, _ in
            let payload = data.map { Self.reading(from: $0, live: false).payload() }
            DispatchQueue.main.async { settle(payload) }
        }
        return true
    }

    /// `CMPedometerData` -> the wire shape. Every optional is gated on the
    /// matching `is*Available()` so an absent capability is OMITTED rather than
    /// zero-filled — a `0` would lie about a watch with no altimeter.
    ///
    /// `currentPace`/`currentCadence` are documented nil on a HISTORICAL query,
    /// so `live` decides whether to read them at all rather than trusting a
    /// value Apple says isn't there.
    private static func reading(
        from data: CMPedometerData, live: Bool
    ) -> PedometerReading {
        PedometerReading(
            startMs: data.startDate.timeIntervalSince1970 * 1000,
            endMs: data.endDate.timeIntervalSince1970 * 1000,
            steps: data.numberOfSteps.doubleValue,
            distanceMeters: CMPedometer.isDistanceAvailable()
                ? data.distance?.doubleValue : nil,
            floorsAscended: CMPedometer.isFloorCountingAvailable()
                ? data.floorsAscended?.doubleValue : nil,
            floorsDescended: CMPedometer.isFloorCountingAvailable()
                ? data.floorsDescended?.doubleValue : nil,
            currentPaceSecPerMeter: live && CMPedometer.isPaceAvailable()
                ? data.currentPace?.doubleValue : nil,
            currentCadenceStepsPerSec: live && CMPedometer.isCadenceAvailable()
                ? data.currentCadence?.doubleValue : nil,
            averageActivePaceSecPerMeter: CMPedometer.isPaceAvailable()
                ? data.averageActivePace?.doubleValue : nil)
    }
}
#endif
