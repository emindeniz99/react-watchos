# The PLATFORM-DATA package — WatchConnectivity completion, EventKit, Always-On

Shipped 2026-07-29. Three queue items landed together because they answer one
question a watch app keeps asking: **what does this device know that JS
cannot?** Files the phone sent, the user's schedule, and whether anyone is
actually looking at the screen.

This is a decision record, not a tutorial. The API surface is documented in
[api/](./api/README.md) and in the JSDoc; what follows is the reasoning that
would otherwise be re-derived — wrong — later.

## The headline availability finding

**Nothing in this package needs an `@available` gate.** The whole set was swept
from Apple's docs JSON (`metadata.platforms[].introducedAt` / `.deprecatedAt`).
The highest floor anywhere in it is `EKEventStore.requestFullAccessToEvents(completion:)`
at **watchOS 10.0** — exactly this package's floor. Everything else is watchOS
2.0–9.0, including `EnvironmentValues.isLuminanceReduced` (8.0) and
`View.onChange(of:initial:)` (10.0).

Two symbols were checked and deliberately **not** used:

- `EKEventStore.requestAccess(to:completion:)` — `deprecatedAt` watchOS 10.0,
  i.e. deprecated *at our floor*. Project rule 1 (pre-release, prefer the clean
  shape) gives no compatibility argument for shipping it.
- `NSCalendarsUsageDescription` — same story, deprecated at 10.0. The plugin
  emits the two `…FullAccess…` keys instead.

One symbol was checked and found **absent on watchOS**:
`WCSessionDelegate.sessionWatchStateDidChange(_:)` has no watchOS row at all
(iOS / iPadOS / Mac Catalyst only). That is what makes the state-change surface
on this side exactly three callbacks — activation, reachability, companion-app
install — and therefore one `watchConnectivity.state` event.

## Item 4 — WatchConnectivity: the file channel and the session state

### The transfer does not park its invoke

The `startExtendedRuntimeSession` / `registerForRemoteNotifications` precedent
in this codebase is to park the invoke id and settle it from the real delegate
callback, so `await` means "it happened". That precedent **does not apply
here**, and applying it would have been the defect:

- Apple documents `transferFile(_:metadata:)` as asynchronous and throttled
  "to accommodate performance and power concerns".
- The queue survives app suspension, so a transfer can complete in a **later
  launch** — a process that never called `transferFile` at all.

A parked invoke would therefore blow `INVOKE_TIMEOUT_MS` (30 s) routinely, and
`USER_MEDIATED_INVOKE_TIMEOUT_MS` (5 min) does not fix "next launch" either. So
`transferFile` resolves **once queued**, with an id — semantically what
`transferUserInfo` already documents — and completion arrives on the
`watchConnectivity.fileTransfer` push channel.

### The correlation id is minted on the bridge, and never reset

`WCSessionFileTransfer` has no identity property ("You do not create instances
of this class yourself"), so the id is ours: a monotonic `Int` on
`PhoneConnectivity`, with `[ObjectIdentifier: Int]` + `[Int: WCSessionFileTransfer]`
(the strong reference is needed for `cancel()` anyway), under an `NSLock`
because `transferFile` runs on main and `didFinish` on a background thread.

This is **deliberately the opposite** of `BluetoothBridge.resetPendingForReload()`,
and the contrast is the whole justification. BLE correlation ids come from the
*runtime's* id space, which restarts at 1 on every boot — so a late delegate
could settle a different promise that happened to reuse an id, which is why
that reset hook exists. These ids come from an object that outlives every JS
generation, so they are never reused: a `didFinish` from a previous generation
carries an id the new generation never issued, and its listener simply does not
recognise it. Adding a reset here would *reintroduce* the hazard.

The honest limit, documented on both sides of the bridge: a transfer queued in
a previous **launch** reappears in `outstandingFileTransfers` with no id we
minted, and is reported — and completes — as `id: null`.

### The inbound move is the one ordering that cannot be got wrong

Apple states three things about `session(_:didReceive:)`: the file is in a
temporary directory, "you must move it **synchronously**", and "if you don't
move the file, the system deletes it after this method returns". Every other
delegate method in `PhoneConnectivity` hops to main first (`deliver`), so
writing this one to the same shape is the natural mistake — and it would lose
**every received file, silently**.

So the move happens inline, on the background thread the delegate is called on,
*before* the main hop. `platform-data-guards.test.ts` pins that order by index;
reverting it turns exactly that test red.

Landing zone: `Application Support/ReactWatchInbox/<receivedAtMs>-<seq>-<name>`.

- **Not `.cachesDirectory`** — system-purgeable, and the file has to survive
  until JS reads it.
- **Not the App Group** — `appGroupId` is optional in `ReactWatchModel.init`, so
  a nil group would leave receive silently broken for every app that never
  configured one. (Choosing the group would let a future image-complication
  feature read received files. That feature does not exist; this was not the
  commit to speculate for.)
- The timestamp is in the name because the per-process sequence resets with the
  process: without it, a file received in a later launch could overwrite one the
  app still holds a path to.

Retention is bounded (newest 32 / 7 days, pruned on each receive) **and**
explicit: `deleteReceivedFile(path)` exists because a native-only LRU would
delete files an app is still using. The path a bundle hands back is resolved
through `FileInbox.resolve`, which standardizes `..` away *before* comparing
prefixes — without it a bundle could ask the host to delete anything in the
container.

`deleteReceivedFile` alone is not a sufficient mitigation, though, and the gap
is the one place the LRU could bite hardest: an app **cannot** release a file
whose event it has not received yet. The prune runs inline on the delegate's
background thread while `deliver` only *schedules* onto main, so a backlog —
WCSession's file queue survives suspension, so a relaunch can deliver one
back-to-back — can outrun main by more than 32 and delete a path JS was never
handed. Silent in both directions: nothing reports it, and `FileInbox.resolve`
still accepts the dead path, so `deleteReceivedFile` on it returns success.

So retention takes a **protected set**: `FileInbox.victims`/`prune` accept URLs
that are never dropped, and `PhoneConnectivity` holds a path protected from the
moment it lands until its `watchConnectivity.file` event has actually *run* on
main (`deliver`'s `then:` completion, not its scheduling). Protected entries
keep their place in the newest-first ordering, so an empty set behaves
identically to the plain rule. The trade-off is deliberate: while a burst is
undelivered the inbox may exceed 32, collapsing back as soon as main drains —
bounded by burst size. Capping the protected set would give a hard 2× ceiling
but reintroduce the dead path for the oldest undelivered file, which is the bug
the set exists to close.

`FileInbox` lives in `ReactWatchSupport` and is unit-tested on Linux against a
real temporary directory: sanitization of the sender-supplied name, the
retention rule, and the containment check.

### Reachability is observability, not a gate

`getConnectivityState()` and `watchConnectivity.state` exist so a UI can *show*
a connection state and a bug report can carry one. The JSDoc says outright not
to gate sends on `reachable`, and points at
[notes/watchconnectivity-reliability.md](../notes/watchconnectivity-reliability.md),
whose field lesson is that `isReachable` returns `true` while delivery is
failing ("a random bool generator with a confidence problem"). Apple's own
caveat — the value is meaningful only while `activationState == .activated` —
is on the field.

### The size number is ours, and it warns

Apple publishes **no** byte cap for `transferFile` (unlike the plist channels).
What is documented is throttling, and `WCError.insufficientSpace` /
`.payloadTooLarge` / `.transferTimedOut` / `.fileAccessDenied`. So the 1 MB soft
cap in `BudgetPolicy` is **ours, provisional, unmeasured** — same honesty
posture as the unmeasured numbers in
[performance-measurement.md](./performance-measurement.md). Crossing it emits
one `budget` diagnostic (hysteresis) and the file **still transfers**, because
`WCError` — not our number — is the authority on what is actually too large.

### Recorded, not built

- **Progress push channel.** `WCSessionFileTransfer.progress` exists (watchOS
  5.0), but streaming it to JS means a KVO observer per transfer pushing at an
  unbounded rate — the exact anti-pattern
  [perf-battery-audit-2026-07-08.md](./perf-battery-audit-2026-07-08.md) §P1-1
  measures. Poll `outstandingFileTransfers()` instead. Revisit only with a
  consumer asking for it.
- **`files` as its own ARCH-07 feature.** Kept under `connectivity`: same kind
  of privilege as `transferUserInfo`, just a larger payload. The real
  counter-argument is that inbound receive **writes files into the app
  container**, which no other `connectivity` op does; it did not tip the
  decision because the write target is a package-owned inbox an app can only
  read back through paths native handed it. If that ever tips, the name is
  `files`.

## Item 5 — EventKit: a read-only API that must ask for full access

The load-bearing quote, from *Accessing the event store*: **"Your app can't
request read-only access to either events or reminders. To read events or
reminders from the event store, your app needs full access."** So a read-only
v1 calls `requestFullAccessToEvents` / `requestFullAccessToReminders` despite
the name. `requestWriteOnlyAccessToEvents` cannot read.

### `writeOnly` is not `denied`

Both are unreadable, which is what the *caller* acts on — but they mean
opposite things to the *person* who chose them. Folding write-only into
`denied` would have an app tell someone who granted "add only" that they
refused. `notDetermined` is split out for the same reason: it is the one
refusal that re-prompting actually fixes, and the rejection message says so.

`.authorized` is not a case in the mapping: it is the pre-17 spelling of the
same raw value as `.fullAccess`, so naming both would be a duplicate case, not
extra coverage.

### One `calendar` feature, not two

Events and reminders each carry their own OS-level TCC prompt, so the OS
already gates them individually and ARCH-07 only has to answer the coarse "may
this bundle touch the user's schedule at all". This is the inverse of the
`push`-vs-`notifications` split, whose justification was a grant that genuinely
differed: APNs registration hands out a routable token with no user prompt at
all. Splitting is defensible under a strict reading of "each feature is an
authorization unit"; it was not taken because the split would map to no
independently-grantable consent the OS does not already provide.

### Three native details that are defects if missed

1. **One long-lived `EKEventStore`.** Apple: "Releasing an event store instance
   before other EventKit objects may result in an error." A per-call store
   frees itself while the `EKEvent`s it vended are still being read.
2. **`events(matching:)` is synchronous and can be slow**, so it runs on a
   private serial queue and settles back on main, generation-guarded (CX-008).
3. **ObjC-imported implicitly-unwrapped optionals.** `EKEvent.startDate` /
   `.endDate`, `EKCalendarItem.title` / `.calendar` all arrive as IUOs. They are
   coerced natively (`?? ""`) and an event with no `startDate` is **dropped**
   rather than pinned to 1970 — so the declared non-optional wire fields are
   honest.

`EKEvent.eventIdentifier` is **not unique per occurrence** of a recurring
series. The schema, the JSDoc and the generated docs all name `id + startMs` as
the React key.

### Empty vs. denied stays distinguishable

The `handleSearchPOI` split, applied: an empty window resolves `[]`, a
malformed request rejects `INVALID_REQUEST`, and an unreadable authorization
rejects `PERMISSION_DENIED` — matching the `OneShotLocation` `.denied` vs
`.unavailable` split, and the correction `queryPedometer` needed. Resolving
`[]` for a denial makes "you said no" indistinguishable from "nothing on your
calendar", which is the one answer this API must not fake.

### Plugin

`calendar?: boolean`, default **false** (M13 least privilege — an unused usage
string draws App Review scrutiny). True emits
`NSCalendarsFullAccessUsageDescription` + `NSRemindersFullAccessUsageDescription`
into the watch target's Info.plist. **No entitlement**: the
`com.apple.security.personal-information.calendars` one Apple documents is for
**sandboxed macOS apps**. The pairing is load-bearing — Apple: "if your app
doesn't include usage description keys… iOS automatically denies any access
request", i.e. without them the OS refuses without ever prompting.

### Recorded, not built

- **`getCalendarAccessStatus`** (a non-prompting status read). Deferred:
  `requestFullAccess*` returns the current status without re-prompting once
  determined, so v1 needs one op. Add it when a consumer needs to render
  "Calendar access is off" without ever having asked.
- **Writes** (create/edit/complete). Out of scope for v1; they are a different
  authorization story and a different API shape.

## Item 6 — Always-On: the defensive-battery load-bearer

### The claim

On Apple Watch the display **stays on** when the user lowers their wrist — and
since watchOS 8 an app participates by default; there is no opt-in to make. So
a bundle's `setInterval` poll, chart animation, or 100 ms timer keeps costing
CPU wakeups and pixels the whole time the wrist is down.
`onLuminanceReduced(reduced => …)` is the signal to stand down:

```tsx
useEffect(() => onLuminanceReduced(setDimmed), []);
useEffect(() => {
  if (dimmed) return;                 // wrist down: no ticking
  const t = setInterval(tick, 100);
  return () => clearInterval(t);
}, [dimmed]);
```

It **compounds** with [perf-battery-audit-2026-07-08.md](./perf-battery-audit-2026-07-08.md)
§P1-1 (JS timers scheduled with near-zero leeway, "the broadest ongoing cost in
the runtime"). That finding makes wakeups coalescable; this one removes them
entirely for the window nobody is looking.

Two caveats the docs must carry, both verified:

- **`WKSupportsAlwaysOnDisplay = false`** is the *opt-out*, which restores the
  system's wrist-down blur. It is the escape hatch for an app that cannot
  afford to keep rendering — not a substitute for pausing work.
- **`scenePhase` is not this signal.** SwiftUI's docs define no `ScenePhase`
  value for the Always-On state. An app keying off `scenePhase` will never see
  wrist-down.

### Read once, at the root

`ReactWatchRootView`, next to the existing `@Environment(\.scenePhase)`.
**Not** `NodeView`: that is instantiated per node, so reading the environment
there would fan one global signal across the whole tree and re-evaluate every
node's body on every wrist-down — adding the exact cost the signal exists to
remove.

### Both initial-value mechanisms, and why neither is redundant

1. `.onChange(of: isLuminanceReduced, initial: true)` (watchOS 10.0, the
   floor). `.onChange` alone fires only on *change*, so a bundle that mounts
   while the wrist is already down would believe luminance is normal and keep
   its timers running — precisely the failure the feature prevents.
2. The model stores the last value and **re-pushes it at the end of `boot()`
   once `jsReady`**. Necessary because `pushNativeEvent` reaches nobody while
   `jsReady == false` (there is no `__pushNativeEvent` global before the bundle
   evaluates), and SwiftUI does not order `.onChange(initial:)` against
   `.onAppear { model.start() }`. Without it the initial push races the runtime
   and is silently dropped — and an OTA hot-reload would never learn the state
   at all, because the wrist has not moved.

Deleting either leaves a hole whose only symptom is battery drain, so both are
pinned by a guard test.

### A pure push event

No schema entry, no host method, no invoke, no HostPolicy feature — the
`scenePhase` / `openURL` / `backgroundRefresh` / `diagnostic` shape, none of
which are policy-gated. There is deliberately no getter, so there is no second
source of truth for a value that is only ever pushed.

### No widget-side luminance in v1

Three reasons, in order of force:

1. The widget tree renders from a **published payload**, not live JS. There is
   no JS listener in the extension for a push event to reach.
2. Nothing in the fetched WidgetKit or SwiftUI docs says WidgetKit sets
   `isLuminanceReduced` in a complication. The documented watchOS
   complication-appearance knob is `EnvironmentValues.widgetRenderingMode`
   (watchOS 9.0, `.fullColor` / `.accented`) — a *native rendering* concern the
   interpreter would apply itself, not a JS event.
3. `TimelineView` + `TimelineScheduleMode.lowFrequency` is the Always-On cadence
   mechanism for **app** views; this project's widgets are timeline-entry based.

**Follow-up recorded:** `widgetRenderingMode` → the `WidgetNodeView` modifier
chain, as its own item with its own device verification.

## What is verified, and what is not

Everything Linux can decide is decided on Linux: `FileInbox` (sanitization,
retention, containment) and `CalendarPlan` (entity vocabulary, window rules,
limit clamp) are `ReactWatchSupport` and run under `swift test`; the ARCH-11
fixtures round-trip in both directions; the native producers and the routing
are pinned by textual scans; and `platform-data-guards.test.ts` holds the ten
rules whose violation is silent.

The Mac/device gaps, stated plainly:

1. 🔴 **File transfer cannot be validated on a simulator at all.** Apple says so
   twice, in two warning asides: "The Simulator app doesn't support the
   `transferFile(_:metadata:)` method", and "The system doesn't call the
   `session(_:didReceive:)` method in Simulator". This needs **paired physical
   devices** and belongs on the same owner-blocked list as the battery-drain run
   in [performance-measurement.md](./performance-measurement.md) §5.
2. 🔴 **`fetch("file:///…")` against a received file** is the one link in the
   read path that could not be proven from docs. `FetchPlan` requires only an
   absolute URL with a scheme and `js/src/fetch.ts` documents that it does not
   restrict schemes, so the chain *should* hold — but URLSession data tasks
   against `file://` need a device/sim check. If it fails, the fallback is a
   `readReceivedFile` invoke returning base64, which is a separate decision.

   Three things about this path are **not** device questions and are now stated
   on `ReceivedFile.path` itself, because that JSDoc is the source of the
   published API page and was asserting the read path flatly:

   - A `file://` load is not an `HTTPURLResponse`, so `performFetch`'s
     `http?.statusCode ?? 0` reports `status: 0` — `ok === false`,
     `statusText === "Server Error"` — on a read that fully succeeded.
     `arrayBuffer()` still returns the bytes, so this is failure-shaped success
     signalling rather than a broken read, but the module advertises a WHATWG
     subset that exposes `ok`.
   - `FetchResponse.classifyBody` caps a bridged body at 5 MiB (QuickJS heap
     protection) and the sending phone is under no matching cap, so a larger
     file lands, fires `onReceivedFile` with an accurate `size`, and is
     **permanently unreadable** — there is no other byte-reading API and
     `file://` honours no Range. This is a functional hole, not a doc gap; the
     `readReceivedFile` fallback above is what closes it.
   - `fetch` is gated on the `network` feature while the file ops are
     `connectivity`, so a bundle policy-limited to `connectivity` receives
     files it cannot open. A `connectivity`-gated `readReceivedFile` would
     close this at the same time.
3. **EventKit prompts** — the TCC sheet, the `.writeOnly` vs `.fullAccess`
   mapping, and that the `NSCalendars*FullAccess*` keys actually reach the built
   `Info.plist` after `expo prebuild`.
4. **Luminance** — that the initial-value push lands when mounting with the
   wrist already down, and that the two mechanisms don't double-fire on a hot
   reload. Wrist-down is reproducible on device; on the simulator it is not.
5. **`xcodebuild -sdk watchsimulator`** remains the only real type-check of
   every `#if os(watchOS)` block — `swiftc -parse` does not type-check inactive
   branches, and that is this repo's standing gap, not a new one.
