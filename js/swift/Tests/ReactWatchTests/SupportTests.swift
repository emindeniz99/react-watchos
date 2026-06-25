import Foundation
import ReactWatchCore
import ReactWatchSupport
import XCTest

// Unit tests for the platform-support logic extracted from the SwiftUI host —
// the optimistic-controls bookkeeping and the notification trigger math, the
// parts with real edge cases. These ran "unverified until a Mac" while inline
// in ReactWatchHost; now they're checked on Linux.
final class OptimisticStoreTests: XCTestCase {
    func testHoldsValuesByKindUntilAcked() {
        var store = OptimisticStore()
        XCTAssertTrue(store.isEmpty)

        store.set(nodeId: 1, seq: 5, value: .bool(true))
        store.set(nodeId: 2, seq: 6, value: .number(42))
        store.set(nodeId: 3, seq: 7, value: .string("draft")) // CR-3: TextField
        XCTAssertEqual(store.bool(1), true)
        XCTAssertEqual(store.int(2), 42)
        XCTAssertEqual(store.double(2), 42)
        XCTAssertEqual(store.string(3), "draft")
        XCTAssertNil(store.bool(2)) // wrong kind -> nil
        XCTAssertNil(store.string(1)) // wrong kind -> nil
        XCTAssertNil(store.int(99)) // unknown id -> nil
    }

    func testAckDropsOnlyCaughtUpEntries() {
        var store = OptimisticStore()
        store.set(nodeId: 1, seq: 5, value: .bool(true))
        store.set(nodeId: 2, seq: 8, value: .bool(false))

        // A commit that acks through seq 5 clears node 1 but not the newer node 2.
        store.ack(throughSeq: 5)
        XCTAssertNil(store.bool(1))
        XCTAssertEqual(store.bool(2), false)

        store.ack(throughSeq: 8)
        XCTAssertTrue(store.isEmpty)
    }
}

final class NotificationPlanTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    func testRelativeAfterMs() throws {
        let plan = try XCTUnwrap(NotificationPlan(
            json: #"{"id":"a","title":"T","body":"B","afterMs":30000,"sound":true}"#,
            now: now))
        XCTAssertEqual(plan.id, "a")
        XCTAssertTrue(plan.sound)
        XCTAssertEqual(plan.triggerSeconds, 30, accuracy: 0.001)
        XCTAssertFalse(plan.scheduledInPast)
    }

    func testAbsoluteAtWinsOverAfterMs() throws {
        let at = (now.timeIntervalSince1970 + 60) * 1000
        let plan = try XCTUnwrap(NotificationPlan(
            json: #"{"id":"b","title":"T","body":"B","at":\#(at),"afterMs":5000,"sound":false}"#,
            now: now))
        XCTAssertEqual(plan.triggerSeconds, 60, accuracy: 0.001)
    }

    func testPastTimeClampsToOneSecondAndFlags() throws {
        let at = (now.timeIntervalSince1970 - 120) * 1000
        let plan = try XCTUnwrap(NotificationPlan(
            json: #"{"id":"c","title":"T","body":"B","at":\#(at),"sound":false}"#,
            now: now))
        XCTAssertTrue(plan.scheduledInPast)
        XCTAssertEqual(plan.triggerSeconds, 1) // never silently in the past
    }

    func testBadPayloadReturnsNil() {
        XCTAssertNil(NotificationPlan(json: "not json", now: now))
        XCTAssertNil(NotificationPlan(json: #"{"id":"x"}"#, now: now)) // missing fields
    }
}

final class RouteMatcherTests: XCTestCase {
    func testLiteralRouteMatchesExactly() {
        XCTAssertEqual(RouteMatcher.match(pattern: "/lists", route: "/lists")?.params, [:])
        XCTAssertNil(RouteMatcher.match(pattern: "/lists", route: "/list"))
        XCTAssertNil(RouteMatcher.match(pattern: "/lists", route: "/lists/1"))
    }

    func testCapturesSingleParam() {
        XCTAssertEqual(
            RouteMatcher.match(pattern: "/list/[id]", route: "/list/42")?.params,
            ["id": ["42"]])
        // [id] is one segment, not a catch-all.
        XCTAssertNil(RouteMatcher.match(pattern: "/list/[id]", route: "/list/42/items"))
        XCTAssertNil(RouteMatcher.match(pattern: "/list/[id]", route: "/list"))
    }

    func testRequiredCatchAllNeedsAtLeastOneSegment() {
        XCTAssertEqual(
            RouteMatcher.match(pattern: "/shop/[name]/[...rest]", route: "/shop/nike/a/b")?
                .params,
            ["name": ["nike"], "rest": ["a", "b"]])
        XCTAssertNil(RouteMatcher.match(pattern: "/shop/[name]/[...rest]", route: "/shop/nike"))
    }

    func testOptionalCatchAllMatchesZeroSegments() {
        XCTAssertEqual(
            RouteMatcher.match(pattern: "/shop/[name]/[[...rest]]", route: "/shop/nike")?
                .params,
            ["name": ["nike"], "rest": []])
        XCTAssertEqual(
            RouteMatcher.match(
                pattern: "/shop/[name]/[[...rest]]", route: "/shop/nike/shoes/running")?
                .params,
            ["name": ["nike"], "rest": ["shoes", "running"]])
    }

    func testBestPicksMostSpecificMatch() {
        // Both patterns match /shop/nike; the concrete one must win.
        let winner = RouteMatcher.best(
            patterns: ["/shop/[name]/[[...rest]]", "/shop/[name]"],
            route: "/shop/nike")
        XCTAssertEqual(winner?.pattern, "/shop/[name]")
        XCTAssertNil(RouteMatcher.best(patterns: ["/list/[id]"], route: "/other"))
    }
}

// CR-10: the BLE bridge keyed characteristics by the raw string, so a write/
// subscribe by the full 128-bit UUID missed one CoreBluetooth stored in short
// form. canonical() collapses every form to one key.
final class BluetoothUUIDTests: XCTestCase {
    private let hrm = "00002A37-0000-1000-8000-00805F9B34FB" // heart-rate measurement

    func testShortAndLongFormsCollide() {
        XCTAssertEqual(BluetoothUUID.canonical("2A37"), hrm)
        XCTAssertEqual(BluetoothUUID.canonical("2a37"), hrm) // case-insensitive
        XCTAssertEqual(BluetoothUUID.canonical(hrm.lowercased()), hrm)
        XCTAssertEqual(BluetoothUUID.canonical(hrm), hrm)
    }

    func testThirtyTwoBitShortExpands() {
        XCTAssertEqual(
            BluetoothUUID.canonical("12345678"),
            "12345678-0000-1000-8000-00805F9B34FB")
    }

    func testCustom128BitNormalizesCase() {
        XCTAssertEqual(
            BluetoothUUID.canonical("1234abcd-0000-1000-8000-00805f9b0000"),
            "1234ABCD-0000-1000-8000-00805F9B0000")
    }

    func testRejectsMalformed() {
        XCTAssertNil(BluetoothUUID.canonical("")) // empty
        XCTAssertNil(BluetoothUUID.canonical("XYZ")) // non-hex
        XCTAssertNil(BluetoothUUID.canonical("2A3")) // 3 hex: not 4/8/32
        // 32 hex but not in dashed 8-4-4-4-12 form (CBUUID wouldn't accept it).
        XCTAssertNil(BluetoothUUID.canonical(
            hrm.replacingOccurrences(of: "-", with: "")))
    }
}
