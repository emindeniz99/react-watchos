// watchOS-only. Compiles to an empty module off-watchOS (see Package.swift) so
// `swift test` runs on macOS/Linux without CoreLocation.
#if os(watchOS)
import CoreLocation

/// A single-fix location request (`CLLocationManager.requestLocation`) wrapped
/// so the host can settle an invoke Promise with one `{lat, lon}`. Retain the
/// instance until `onResult` fires. It prompts for When-In-Use authorization if
/// undetermined and reports failure if denied. Create it on the main queue —
/// CLLocationManager needs a run loop. `requestLocation()` guarantees exactly
/// one delegate callback (a fix or an error), and every authorization path ends
/// in one too, so `onResult` always fires — no separate timeout needed.
final class OneShotLocation: NSObject, CLLocationManagerDelegate {
    /// Why the fix failed — the two cases mean different things to the caller
    /// and map to different invoke codes: `denied` is the USER's decision
    /// (PERMISSION_DENIED — re-prompting won't help, Settings will), while a
    /// CoreLocation error or an unrecognized authorization state is
    /// UNAVAILABLE. Collapsing both into one code (the old
    /// `LOCATION_UNAVAILABLE`) told the caller nothing actionable.
    enum Failure: Error, Equatable {
        /// `.denied` / `.restricted` — the user (or a profile) said no.
        case denied
        /// No fix available: a CLError, or an authorization state this build
        /// doesn't know (@unknown default).
        case unavailable
    }

    private let manager = CLLocationManager()
    private let onResult: (Result<CLLocationCoordinate2D, Error>) -> Void
    private var settled = false

    init(onResult: @escaping (Result<CLLocationCoordinate2D, Error>) -> Void) {
        self.onResult = onResult
        super.init()
        manager.delegate = self
        start()
    }

    private func start() {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            finish(.failure(Failure.denied))
        @unknown default:
            finish(.failure(Failure.unavailable))
        }
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        switch m.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: m.requestLocation()
        case .notDetermined: break  // still waiting on the prompt
        case .denied, .restricted: finish(.failure(Failure.denied))
        @unknown default: finish(.failure(Failure.unavailable))
        }
    }

    func locationManager(_: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let coordinate = locs.last?.coordinate else { return }
        finish(.success(coordinate))
    }

    func locationManager(_: CLLocationManager, didFailWithError error: Error) {
        finish(.failure(error))
    }

    private func finish(_ result: Result<CLLocationCoordinate2D, Error>) {
        guard !settled else { return }
        settled = true
        onResult(result)
    }
}
#endif
