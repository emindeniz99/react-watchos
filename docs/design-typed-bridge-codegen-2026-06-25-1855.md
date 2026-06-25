# Design note — typed command channel + finish codegen (SD-1 / SD-6)

Short pre-code note. SD-1 and SD-6 pair up: SD-6 makes the schema the single
source for the bridge, which makes SD-1's typed channel cheap to express (and
carries the `since` tags SD-3 needs + the runtime guard).

> **Pre-release:** change the bridge shape freely; no back-compat for the
> current ad-hoc calls.

## SD-1 — typed command/result channel

### Problem
The bridge has four call shapes ([host.ts:40](../js/src/host.ts)); the
**fire-and-forget** ones (`setItem`, `playHaptic`, `scheduleNotification`,
`sendToPhone`, `ble`, `sensor`, `saveUpdate`, `publishWidgets`) have **no way to
report failure** → CX-022 (silent native failures) and CX-005 (`applyUpdate`
can't be rejected) are symptoms of this one gap.

### Design — make the fallible ones look like `fetch`
`fetch`/`generate` already do it right (request id → `__resolve/__rejectX`).
Generalize that into one mechanism:

```
JS → __host.invoke(id, method, payloadJson)
native → __resolveInvoke(id, resultJson)  |  __rejectInvoke(id, {code, message})
```
- JS exposes promise-returning wrappers; callers `await` and get a typed result
  or a typed error.
- **Typed errors:** `{ code, message }` with a small enum — `unavailable`,
  `denied`, `invalid`, `failed` — so JS can tell "capability missing" from
  "permission denied" from "bad input" (CX-022's acceptance).
- **Route through it:** `saveUpdate` (→ `{accepted, activeReleaseId, reason}`,
  CX-005), `requestNotificationPermission` (→ `granted|denied`),
  `scheduleNotification`, BLE `connect`/`write`. 
- **Keep as-is:** sync `getItem` (hot path, returns null on miss — not worth
  async); the **push channel** for streams (sensors, BLE notify, connectivity).
- `fetch`/`generate` can either fold into `invoke` or stay as-is (they already
  have the shape) — folding is tidier but optional.

### Result
Every fallible native op is observable from JS. The widget's intent path and the
app both get real errors instead of silence.

## SD-6 — schema is the single source for wire + bridge + components

### Problem
[schema.mjs](../js/codegen/schema.mjs) generates the wire structs (both sides) and
a `hostMethods` *manifest a test checks* — but the bridge **implementation**
(install table, C trampolines, TS `QuickJSHostGlobal`) and the **component
contract** (primitives, props, events, app/widget support) are hand-written.
That's exactly where drift lives (CX-018/023/024).

### Design — extend the schema to be authoritative for all three
1. **Wire structs** — done.
2. **Bridge (CX-023):** each `hostMethods[]` entry already has `name`/`targets`;
   add **`kind`** (`fireAndForget` | `command` | `request` | `sync` | `push`),
   **`since: Int`** (host-API version it shipped in — SD-3), and arg/result
   shapes. Generate from it:
   - the Swift install table + `@convention(c)` trampolines (kills the manual
     block in [JSRuntime.swift:359](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift)),
   - the TS `QuickJSHostGlobal` type,
   - the JS wrappers — each routes through SD-1's `invoke` for `command`/`request`
     kinds, and through the **runtime guard** (`callHost(name, since, …)` throws a
     typed `CapabilityError` if absent — SD-3 defense-in-depth).
3. **Component contract (CX-024):** add a **primitives** table — type, props,
   events, `since`, and per-context support (`app` / `widget` / degraded). Feeds:
   - the `minHostApi` build derivation (SD-3) for primitives,
   - SD-2's golden support-matrix test,
   - (later) generated prop typings.

### Why together
SD-6's generated wrappers are *where* SD-1's typed channel and SD-3's
guard/`since` live — generating them means the bridge, the typed errors, the
capability gate, and the guard all come from one table instead of four
hand-synced places.

## Sequencing within these two
1. SD-6 step 2 (bridge schema + generation) first — it creates the seam.
2. SD-1 (typed channel) rides on the generated `command`/`request` wrappers.
3. SD-6 step 3 (component contract) with / just before SD-2.

## Tests
- Generated output is committed + a `codegen drift` check (exists) guards it.
- Bridge round-trip: each `command` method resolves/rejects with a typed error.
- Guard: calling an absent capability throws `CapabilityError`, not a crash.
