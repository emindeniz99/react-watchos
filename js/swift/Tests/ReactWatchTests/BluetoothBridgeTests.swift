// The BLE bridge is watchOS-only (#if os(watchOS) in ReactWatchHost); these
// tests compile to nothing under `swift test` on macOS/Linux and run only on
// the watchOS simulator via `xcodebuild test`. They cover the parts that, when
// wrong, HANG a JS promise forever — the handleInvoke request guards and the
// connect-timeout drain/epoch — which the Linux-tested BleSession can't reach
// (it's pure correlation; the bridge is the CoreBluetooth-facing orchestration).
#if os(watchOS)
import XCTest

@testable import ReactWatchHost

final class BluetoothBridgeTests: XCTestCase {
    /// A bridge plus accessors for what it resolved / rejected. The guard tests
    /// never reach CoreBluetooth; the timeout tests drive `handleConnectTimeout`
    /// directly so there's no 15s real-time wait.
    private func makeBridge(connectTimeout: TimeInterval = 15)
        -> (bridge: BluetoothBridge, rejects: () -> [(id: Int, json: String)])
    {
        let bridge = BluetoothBridge(connectTimeout: connectTimeout)
        var rejects: [(id: Int, json: String)] = []
        bridge.onReject = { rejects.append((id: $0, json: $1)) }
        return (bridge, { rejects })
    }

    // MARK: - request validation (rejects before touching CoreBluetooth)

    func testBleWriteWithNoConnectionRejectsFast() {
        let (bridge, rejects) = makeBridge()
        bridge.handleInvoke(
            id: 7, method: "bleWrite",
            payload: #"{"characteristic":"2A37","value":"hi"}"#)
        // No connect was ever issued: queueing this write would wait for a
        // discovery that never comes, so it must reject instead of hanging.
        XCTAssertEqual(rejects().count, 1)
        XCTAssertEqual(rejects().first?.id, 7)
        XCTAssertTrue(rejects().first?.json.contains("UNAVAILABLE") ?? false)
        XCTAssertTrue(rejects().first?.json.contains("not connected") ?? false)
    }

    func testBleSubscribeWithNoConnectionRejectsFast() {
        let (bridge, rejects) = makeBridge()
        bridge.handleInvoke(
            id: 8, method: "bleSubscribe", payload: #"{"characteristic":"2A37"}"#)
        XCTAssertEqual(rejects().count, 1)
        XCTAssertEqual(rejects().first?.id, 8)
        XCTAssertTrue(rejects().first?.json.contains("UNAVAILABLE") ?? false)
    }

    func testBleConnectMalformedServiceUUIDRejects() {
        let (bridge, rejects) = makeBridge()
        // A malformed UUID would crash CBUUID(string:) with an NSException and
        // otherwise hang to the 15s timeout — reject it up front instead.
        bridge.handleInvoke(
            id: 1, method: "bleConnect", payload: #"{"service":"not-a-uuid"}"#)
        XCTAssertEqual(rejects().count, 1)
        XCTAssertEqual(rejects().first?.id, 1)
        XCTAssertTrue(rejects().first?.json.contains("INVALID_REQUEST") ?? false)
        XCTAssertTrue(rejects().first?.json.contains("malformed") ?? false)
    }

    func testBleWriteMalformedCharacteristicUUIDRejects() {
        let (bridge, rejects) = makeBridge()
        bridge.handleInvoke(
            id: 2, method: "bleWrite",
            payload: #"{"characteristic":"zzzz","value":"x"}"#)
        XCTAssertEqual(rejects().count, 1)
        XCTAssertTrue(rejects().first?.json.contains("INVALID_REQUEST") ?? false)
    }

    func testBleConnectMissingServiceRejects() {
        let (bridge, rejects) = makeBridge()
        bridge.handleInvoke(id: 3, method: "bleConnect", payload: "{}")
        XCTAssertEqual(rejects().count, 1)
        XCTAssertTrue(rejects().first?.json.contains("INVALID_REQUEST") ?? false)
    }

    func testUnknownBleMethodRejectsInternal() {
        let (bridge, rejects) = makeBridge()
        bridge.handleInvoke(id: 4, method: "bleFoo", payload: "{}")
        XCTAssertEqual(rejects().count, 1)
        XCTAssertTrue(rejects().first?.json.contains("INTERNAL") ?? false)
    }

    // MARK: - connect-timeout drain + epoch (handleConnectTimeout driven directly)

    func testConnectTimeoutDrainsConnectAndQueuedOps() {
        let (bridge, rejects) = makeBridge()
        // A real connect (valid UUID) marks pendingConnect and arms the timeout.
        bridge.handleInvoke(
            id: 100, method: "bleConnect", payload: #"{"service":"180D"}"#)
        // A write issued WHILE connecting is allowed and queues for discovery.
        bridge.handleInvoke(
            id: 101, method: "bleWrite",
            payload: #"{"characteristic":"2A37","value":"hi"}"#)
        XCTAssertEqual(rejects().count, 0, "nothing settled before the timeout")

        bridge.handleConnectTimeout(id: 100, epoch: 0)

        // BOTH the connect and the write that was waiting on it reject — draining
        // only the connect would leak the queued write's promise.
        XCTAssertEqual(Set(rejects().map(\.id)), [100, 101])
        XCTAssertTrue(rejects().allSatisfy { $0.json.contains("connect timed out") })
    }

    func testFailedConnectDrainsConnectAndQueuedOps() {
        let (bridge, rejects) = makeBridge()
        bridge.handleInvoke(
            id: 200, method: "bleConnect", payload: #"{"service":"180D"}"#)
        // A subscribe issued WHILE connecting is permitted and queues.
        bridge.handleInvoke(
            id: 201, method: "bleSubscribe", payload: #"{"characteristic":"2A37"}"#)
        XCTAssertEqual(rejects().count, 0, "nothing settled before the failure")

        // The peripheral actively refused the connection (didFailToConnect).
        bridge.failConnectionAttempt(message: "failed to connect")

        // BOTH the connect and the subscribe that was waiting on it reject —
        // draining only the connect would leak the subscribe's promise forever.
        XCTAssertEqual(Set(rejects().map(\.id)), [200, 201])
        XCTAssertTrue(rejects().allSatisfy { $0.json.contains("failed to connect") })
    }

    // MARK: - bounded auto-reconnect (P0-1): window expiry driven directly

    /// Like makeBridge, but also captures pushed connection states. The huge
    /// reconnectWindowMs keeps the real asyncAfter window from ever firing
    /// during a test — expiry is driven manually, like handleConnectTimeout.
    private func makeReconnectBridge(payloadExtra: String = "")
        -> (bridge: BluetoothBridge, states: () -> [String])
    {
        let bridge = BluetoothBridge()
        var states: [String] = []
        bridge.onState = { states.append($0) }
        bridge.handleInvoke(
            id: 1, method: "bleConnect",
            payload: #"{"service":"180D","reconnectWindowMs":600000"# + payloadExtra + "}")
        return (bridge, { states })
    }

    func testWindowExpiryAdvancesAttemptsThenGoesTerminal() {
        let (bridge, states) = makeReconnectBridge(
            payloadExtra: #","maxReconnectAttempts":2"#)
        // The drop starts reconnect attempt 1 of 2 (no central on the test
        // host, so the scan itself pushes nothing).
        bridge.failConnectionAttempt(message: "failed")
        XCTAssertEqual(states(), ["disconnected"])

        // First window expiry: attempt 2 starts — not terminal, no state push.
        // (generation is 1: connect() bumped it once; epoch 0: no reload.)
        bridge.handleReconnectWindowExpiry(epoch: 0, generation: 1, attempt: 1)
        XCTAssertEqual(states(), ["disconnected"])

        // Second expiry: budget spent — the terminal "disconnected" is pushed
        // (the JS side's last observed state from this window was scanning).
        bridge.handleReconnectWindowExpiry(epoch: 0, generation: 1, attempt: 2)
        XCTAssertEqual(states(), ["disconnected", "disconnected"])
    }

    func testStaleGenerationWindowDoesNotTouchTheLiveAttempt() {
        let (bridge, states) = makeReconnectBridge(
            payloadExtra: #","maxReconnectAttempts":1"#)
        bridge.failConnectionAttempt(message: "failed")  // attempt 1 (of 1)

        // A window armed under a PREVIOUS generation fires late with a matching
        // attempt number: it must no-op, not advance/terminate the live attempt.
        bridge.handleReconnectWindowExpiry(epoch: 0, generation: 0, attempt: 1)
        XCTAssertEqual(states(), ["disconnected"])

        // The live window still terminates the exhausted budget.
        bridge.handleReconnectWindowExpiry(epoch: 0, generation: 1, attempt: 1)
        XCTAssertEqual(states(), ["disconnected", "disconnected"])
    }

    func testUserDisconnectNeutralizesAnArmedWindow() {
        let (bridge, states) = makeReconnectBridge()
        bridge.failConnectionAttempt(message: "failed")  // attempt 1 armed
        bridge.handleOp(#"{"op":"disconnect"}"#)  // deliberate disconnect
        let settled = states().count

        // The armed window firing after bleDisconnect() must not rescan or
        // push any further state.
        bridge.handleReconnectWindowExpiry(epoch: 0, generation: 1, attempt: 1)
        XCTAssertEqual(states().count, settled)
    }

    func testReconnectDisabledStaysDownAfterADrop() {
        let (bridge, states) = makeReconnectBridge(
            payloadExtra: #","maxReconnectAttempts":0"#)
        bridge.failConnectionAttempt(message: "failed")
        // No attempt starts and the drop's own "disconnected" is terminal —
        // exactly one push, no duplicate.
        XCTAssertEqual(states(), ["disconnected"])
    }

    func testReloadEpochNeutralizesStaleConnectTimeout() {
        let (bridge, rejects) = makeBridge()
        bridge.handleInvoke(id: 1, method: "bleConnect", payload: #"{"service":"180D"}"#)
        // A runtime swap drains the in-flight connect and bumps the epoch.
        bridge.resetPendingForReload()
        // The new runtime happens to reuse invoke id 1 for its own connect.
        bridge.handleInvoke(id: 1, method: "bleConnect", payload: #"{"service":"180D"}"#)

        // The STALE timeout (armed under epoch 0) fires late: it must NOT reject
        // the new runtime's connect just because the numeric id matches.
        bridge.handleConnectTimeout(id: 1, epoch: 0)
        XCTAssertEqual(rejects().count, 0, "stale timeout rejected the new connect")

        // The new connect's own timeout (epoch 1) still settles it.
        bridge.handleConnectTimeout(id: 1, epoch: 1)
        XCTAssertEqual(rejects().count, 1)
        XCTAssertEqual(rejects().first?.id, 1)
    }
}
#endif
