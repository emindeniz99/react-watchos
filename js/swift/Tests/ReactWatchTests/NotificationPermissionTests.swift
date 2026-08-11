// ReactWatchModel is watchOS-only (#if os(watchOS) in ReactWatchHost); this
// test compiles to nothing under `swift test` on macOS/Linux and runs only
// on the watchOS simulator via `xcodebuild test`.
#if os(watchOS)
import UserNotifications
import XCTest

@testable import ReactWatchHost

/// `requestNotificationPermission` calls `permissionStatus` from inside
/// `UNUserNotificationCenter.getNotificationSettings`'s completion, which
/// runs OFF main — and `getNotificationSettings`'s completion is not
/// `@Sendable`-audited by UNUserNotificationCenter today, which is why this
/// was a warning rather than the hard error CalendarBridge.json hit under
/// Xcode 26.6 (0b61c7d, the same class of mistake). `permissionStatus`
/// itself is a pure, Sendable-safe function; the isolation on its
/// DECLARATION was the mistake, not its behavior.
final class NotificationPermissionTests: XCTestCase {
    /// Calls `permissionStatus` synchronously from a background queue —
    /// exactly the shape `getNotificationSettings`'s off-main completion
    /// uses, and a `DispatchQueue.async` closure IS `@Sendable`-audited, so
    /// with the bug reverted (no `nonisolated` — the class-level `@MainActor`
    /// implicitly isolates the declaration again) this file fails to
    /// COMPILE: "call to main actor-isolated static method 'permissionStatus'
    /// in a synchronous nonisolated context". A build failure is exactly the
    /// failure mode this fix prevents — the whole point of making the
    /// isolation truthful before it's forced by a stricter compiler.
    func testPermissionStatusIsCallableSynchronouslyOffMain() {
        // `.ephemeral` (App Clips) is unavailable as a constructible value on
        // watchOS — the source switch still matches it as a pattern (that's
        // available on every platform), but this test can only exercise the
        // cases watchOS can actually produce.
        let statuses: [UNAuthorizationStatus] = [
            .notDetermined, .denied, .authorized, .provisional,
        ]
        // Sequential `sync` calls, one per status: each still runs the
        // mapping off-main (the property under test), without a mutable var
        // shared across concurrently-executing closures muddying the point.
        let results = statuses.map { status in
            DispatchQueue.global().sync { ReactWatchModel.permissionStatus(status) }
        }

        XCTAssertEqual(Set(results), ["notDetermined", "denied", "granted", "provisional"])
    }

    /// The pure mapping itself, pinned per case (the part that would keep
    /// working even if isolation regressed to a warning instead of an error
    /// on some future SDK).
    func testPermissionStatusMapsEveryCase() {
        XCTAssertEqual(ReactWatchModel.permissionStatus(.notDetermined), "notDetermined")
        XCTAssertEqual(ReactWatchModel.permissionStatus(.denied), "denied")
        XCTAssertEqual(ReactWatchModel.permissionStatus(.authorized), "granted")
        XCTAssertEqual(ReactWatchModel.permissionStatus(.provisional), "provisional")
        // `.ephemeral` (App Clips) can't be constructed on watchOS to test
        // directly — see the comment above.
    }
}
#endif
