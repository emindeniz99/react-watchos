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
        /// `.denied` / `.restricted` — the user (or a profile) said no. Also
        /// `CLError.denied`, which is how Location Services being switched OFF
        /// device-wide arrives: the app's own authorization is untouched, so
        /// the refusal comes back as an error rather than a status change.
        case denied
        /// No fix available: any other CLError, or an authorization state this
        /// build doesn't know (@unknown default).
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

    /// `CLError.denied` lands HERE, not on the authorization path: with the app
    /// granted When-In-Use and Location Services switched off device-wide,
    /// `authorizationStatus` is still `.authorizedWhenInUse`, so `start()` calls
    /// `requestLocation()` and CoreLocation refuses with that code. Passing it
    /// through raw made the host report UNAVAILABLE ("retry / no fix") for a
    /// state only a Settings change can fix, which is precisely the
    /// non-actionable answer this Failure split exists to avoid. Every other
    /// CLError really is "no fix obtainable" and stays unavailable.
    func locationManager(_: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .denied {
            finish(.failure(Failure.denied))
            return
        }
        finish(.failure(error))
    }

    private func finish(_ result: Result<CLLocationCoordinate2D, Error>) {
        guard !settled else { return }
        settled = true
        onResult(result)
    }
}
#endif
