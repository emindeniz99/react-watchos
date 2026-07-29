# Adding a native capability

The extension model is the `__host` op channel out + native pushes in. It's how
every built-in capability (BLE, sensors, haptics, fetch, WatchConnectivity)
works, and it's public — `getHost()` and the host-op type `QuickJSHostGlobal`
are exported from the package. You can add an app-level capability without
forking the renderer.

## The two directions

```
JS  ──  getHost()?.<op>(json)  ──▶  Swift   (commands: do a thing)
JS  ◀──  registerNativeListener(name, cb)  ──  Swift __pushNativeEvent(name, json)
                                                     (events: results / state)
```

- **Out (command):** `getHost()` returns the `__host` global Swift installed,
  or `undefined` off-device (so you can no-op in tests). Call your op with a
  JSON string payload.
- **In (event):** Swift calls `__pushNativeEvent(name, json)`; your listener
  runs inside `runSync`, so a `setState` in it commits immediately.

## Recipe

Say you want a flashlight toggle.

**1. JS wrapper** (in your app, or contribute it to the renderer):

```ts
import { getHost, registerNativeListener } from "react-watchos";

export function setTorch(on: boolean): void {
  // `torch` is an app-defined op; off-device getHost() is undefined → no-op.
  (getHost() as { torch?(json: string): void } | undefined)?.torch?.(
    JSON.stringify({ on }),
  );
}

// registerNativeListener returns an unsubscribe — pass it through so callers
// can clean up in a React effect (`useEffect(() => onTorchState(setOn), [])`).
export function onTorchState(cb: (on: boolean) => void) {
  return registerNativeListener("torch", (p) =>
    cb(Boolean((p as { on?: boolean })?.on)),
  );
}
```

If you're adding the op to the renderer itself, add it to
`codegen/schema.ts`'s `hostMethods` and run `pnpm codegen` —
`QuickJSHostGlobal` is GENERATED (`src/generated/wire.ts`, re-exported from
`src/host.ts`), so hand-editing the type gets overwritten; the schema is the
source of truth and the Swift install is cross-checked from it.

**2. Swift side** installs the op and pushes events. In the SwiftPM package
(`swift/`), `ReactWatchRuntime/JSRuntime.swift` installs the `__host` methods
and `ReactWatchHost/SensorBridge.swift` (and the other bridges) push via
`pushNativeEvent` — register your `torch` op the same way and call
`__pushNativeEvent("torch", "{\"on\":true}")` when state changes.

**3. Use it** like any hook-driven value:

```tsx
const [on, setOn] = useState(false);
useEffect(() => onTorchState(setOn), []);
return <Toggle value={on} onChange={(v) => { setTorch(v); }} label="Torch" />;
```

## Why this shape

The op channel is registered-messages-only (Raycast-style): JS can't call
arbitrary native code, only the ops the host installed. Events commit through
`runSync`, so external state lands on screen instantly without a polling loop.
Keep payloads JSON-serializable — strings are all that cross the QuickJS↔Swift
boundary.

## The hatch is for ops, not views

The recipe above extends the app in **one** direction. Being explicit about
that, because the shape of this page otherwise implies a symmetry that does
not exist:

| | Escape hatch | Where |
|---|---|---|
| **Ops** (do a thing / stream a value) | **Yes** — `getHost()` is exported, and an app can install and call its own `__host` op without touching the renderer | the recipe above |
| **Views** (new node types in the React tree) | **None** | — |

`NodeView.swift` renders the tree with a `switch node.type` whose `default:`
arm calls `unsupportedNode(type)`: the node is skipped, siblings keep
rendering, and the type is logged once. There is no view registry, no
`register(nodeType:)` seam, no protocol an app can conform to — the set of
renderable node types is fixed in the Swift the app was built from.

**This is a design property, not an oversight.** The renderer's contract is
that a node type means the same thing in the app, in the widget extension, and
in the drift-guarded codegen schema that both are generated from. A runtime
view registry would fork that contract three ways and put an OTA bundle in a
position to reference a view the reviewed binary cannot draw. The `default:`
arm exists to make the *other* direction safe: a newer JS bundle degrades
gracefully on an older interpreter instead of failing the whole commit.

**What you can do instead.** The boundary is the React tree, not the screen:

- **Write your own SwiftUI next to the tree.** `ReactWatchRootView` is an
  ordinary SwiftUI view — compose it in a `VStack`, put it in a
  `NavigationStack`, present it in a `.sheet`, or wrap it in your own chrome.
  Anything React doesn't need to own can just be hand-written SwiftUI.
- **Drive that SwiftUI from React over the op channel.** Push state out with a
  custom op and events back in with `__pushNativeEvent` — the same recipe
  above, with your view reading the state instead of a bridge.
- **Contribute the node type.** A genuinely general primitive belongs in
  `codegen/schema.ts` + `NodeView.swift`, where it gets the widget-parity and
  drift checks. That is a PR, not an app-level extension.

What you **cannot** do is inject a node type into the tree from your app or
from an OTA bundle. If your design needs that, the honest answer is that this
renderer is the wrong layer for that part of your UI.

## Built-in capabilities (2026-07 additions)

Beyond the recipe above, these ship as first-class modules — all routed
through the same invoke channel:

| Module | API | Feature |
|---|---|---|
| Device info | `getDeviceInfo()` → battery/wrist/screen/model + accessibility (reduceMotion/voiceOver/text-size) snapshot; `enableWaterLock()` (watchOS has no battery/a11y-change notification; poll it) | `device` |
| Background refresh | `scheduleBackgroundRefresh(afterMs, userInfo?)`, `onBackgroundRefresh(cb)` | `background` |
| Extended runtime | `startExtendedRuntimeSession()`, `stop…`, `onRuntimeSessionState/WillExpire` | `runtime` |
| Keychain | `Keychain.set/get/delete` (encrypted; distinct from `Storage`) | `keychain` |
| Speech (TTS) | `speak(text, opts?)`, `stopSpeaking()`, `onSpeechFinished(cb)` | `speech` |
| Audio | `playAudio(url, opts?)`, `stopAudio()`, `onAudioFinished(cb)` (AVAudioPlayer; downloads the URL, routes to Bluetooth/speaker) | `audio` |
| In-app purchase | `getProducts`, `purchase`, `currentEntitlements`, `restorePurchases` (StoreKit 2) | `iap` |
| File transfer + session state | `transferFile(path, metadata?)` (resolves once QUEUED — completion arrives on `onFileTransfer`, possibly in a later launch), `cancelFileTransfer`, `outstandingFileTransfers`, `onReceivedFile` (already moved into this app's inbox), `deleteReceivedFile`, `getConnectivityState`/`onConnectivityState` | `connectivity` |
| Calendar + reminders (read) | `requestCalendarAccess(entity)`, `getCalendarEvents({startMs,endMs})`, `getReminders()` — EventKit; needs `calendar: true` in the config plugin for the usage strings | `calendar` |
| Always-On | `onLuminanceReduced(reduced => …)` — wrist-down at reduced luminance | *(none — a push event, not policy-gated)* |

**Host policy (ARCH-07):** the consumer app decides which of these features a
bundle may actually use — `ReactWatchRootView(policy: .allow([...]))` (and
`ReactWatchWidgetOTA.configure(policy:)` for the extension). A blocked
feature's `__host` functions aren't installed, its invoke-routed methods
reject with the typed `POLICY_DENIED` code, and OTA staging refuses bundles
that require it. `__hostFeatures` is the *effective* (policy-filtered) set,
so `checkForUpdate`'s `appUpdateRequired`/`missingCapabilities` can also mean
"restricted by the app's HostPolicy" — the fix is an app configuration change
shipped as a native release, not an OTA.

Four honest caveats:

- **Background refresh** is fully wired: `scheduleBackgroundRefresh`
  registers the wake-up, and the package's `ReactWatchAppDelegate` forwards
  the fired `WKApplicationRefreshBackgroundTask` to JS's
  `onBackgroundRefresh` (with your userInfo). It needs the delegate adaptor
  in your `@main` App — `@WKApplicationDelegateAdaptor(ReactWatchAppDelegate.self)`
  — which `react-watchos scaffold` writes for you. Keep the handler
  short; the app suspends again when it returns.
- **Extended runtime sessions** require the consumer to declare the session
  reason in the target's Info.plist; without it the system invalidates the
  session immediately, which surfaces as a `runtimeSession.state` event with
  `state: "invalidated"`.
- **File transfer cannot be exercised on a simulator at all.** Apple states
  both halves: the Simulator does not support `transferFile(_:metadata:)`, and
  the system does not call `session(_:didReceive:)` there. It needs paired
  physical devices. Also: `getConnectivityState().reachable` is
  **observability, not a send gate** — see
  [`notes/watchconnectivity-reliability.md`](../notes/watchconnectivity-reliability.md).
- **Calendar reads need FULL access.** Apple exposes no read-only grant for
  events or reminders, so `requestCalendarAccess` asks for full access even
  though this API only reads. Without the plugin's `calendar: true` (which
  emits the two usage strings) the OS denies every request *without prompting*.

## App Shortcuts / Siri — a native AppIntents concern, not a runtime binding

Registering Siri phrases / App Shortcuts is **compile-time** metadata
(`AppShortcutsProvider` + `AppIntent` types declared in Swift), not something
a JS bundle can register at runtime — the phrases are indexed by the system
from the app binary at install time. So it does not fit the invoke/push
bridge model, and there is deliberately no `registerSiriPhrase` API. The
*execution* surface you'd want is already covered: `registerIntent(name, …)`
runs your React handler for a widget/Control AppIntent. A watch-app-level App
Shortcut is a scaffold step (add the `AppShortcutsProvider` Swift alongside
`WatchApp.swift`) — a candidate for the scaffold CLI, tracked on the roadmap.
