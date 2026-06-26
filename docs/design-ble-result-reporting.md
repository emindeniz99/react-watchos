# BLE connect/write result reporting (design — device-gated)

The last fallible op still off the SD-1 invoke channel (CX-022): `bleConnect` /
`bleWrite` / `bleSubscribe` are fire-and-forget (`__host.ble(json)`), so a
failed connect or write is invisible to JS — only `onBleState` / `onBleNotify`
pushes surface anything. This note specifies the result-reporting migration and
why it is **genuinely device-gated** (so it isn't shipped blind).

## Why it's a redesign, not a mechanical port

Unlike saveUpdate / sendToPhone / scheduleNotification (one request → one
settle), BLE ops settle against an **asynchronous CoreBluetooth state machine**
that already drives the push channel and an auto-reconnect latch
([BleSession](../js/swift/Sources/ReactWatchSupport/BleSession.swift),
[BluetoothBridge](../js/swift/Sources/ReactWatchHost/BluetoothBridge.swift)):

- **connect** is not a single ack. The bridge does scan → `didConnect` /
  `didFailToConnect`, *and* re-connects on an unexpected drop. A
  `bleConnect → Promise` must resolve on the **first** successful connect and
  reject on failure/timeout — without resolving again on every later
  auto-reconnect, and without fighting the existing `onBleState` stream (which
  stays the source of truth for *ongoing* state).
- **write** has no ack today — there is **no `didWriteValueFor` delegate** in
  the bridge (writes are issued and forgotten, and may be queued pre-discovery
  in `BleSession.pendingWrites`). Reporting a result means *adding* that
  delegate and correlating it to the originating write — but only `.withResponse`
  writes ack; `.withoutResponse` never will, so its "result" is at best
  "handed to CoreBluetooth", not "delivered".
- **subscribe** settles on `didUpdateNotificationStateFor`, and must re-settle
  semantics against the re-subscribe-on-reconnect behavior.

## Proposed shape

- Route `connect` / `write` / `subscribe` through `invoke` (schema `via:"invoke"`,
  a `case` in `handleInvoke`), keeping `disconnect` and the
  `onBleState`/`onBleNotify` push channel as-is.
- Put the **correlation bookkeeping in the pure `BleSession`** (a `[invokeId →
  pending ble-op]` map + settle/timeout/cancel transitions), so it's
  **Linux-unit-tested** like the rest of BleSession; CoreBluetooth I/O and the
  actual `resolveInvoke`/`rejectInvoke` stay in the bridge. This keeps the
  *logic* verifiable even though the *I/O* isn't.
- JS: `bleConnect`/`bleWrite`/`bleSubscribe` return `Promise<…>` (or a result
  object) resolving on the correlated delegate callback; `.withoutResponse`
  writes resolve optimistically with a documented caveat.
- Generation-guard (CX-008) + main-thread hop, as the other invoke ops do.

## Why it must be device-verified (not shipped from code review)

The correlation logic can be unit-tested, but the behaviour it correlates —
connect transitions, write acks, notification-state acks, and their interaction
with the **auto-reconnect** latch — only exists against a **real BLE
peripheral** (the movie-remote GATT service the demo targets). There is no
simulator path: the watchOS simulator has no Bluetooth radio. Shipping a
state-machine change to *working* BLE that can't be behaviour-tested risks
silently regressing the demo, with nothing to catch it. So:

- **Do** when a watch + the peripheral are available: implement per above,
  exercise connect/drop/reconnect/write-ack/subscribe on device, then land.
- **Don't** merge a blind redesign; the pure-logic half is ready to be written
  test-first the moment the device half can be exercised.

## Acceptance

- [ ] `BleSession` gains tested correlation bookkeeping (Linux).
- [ ] Bridge adds `didWriteValueFor` + settles connect/write/subscribe invokes.
- [ ] JS BLE ops return results; `.withoutResponse` caveat documented.
- [ ] On-device: connect/fail/reconnect/write-ack/subscribe all verified.
