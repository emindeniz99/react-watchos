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
import { getHost, registerNativeListener } from "react-native-watchos";

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
`codegen/schema.mjs`'s `hostMethods` and run `pnpm codegen` —
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
| In-app purchase | `getProducts`, `purchase`, `currentEntitlements`, `restorePurchases` (StoreKit 2) | `iap` |

Two honest caveats:

- **Background refresh** is fully wired: `scheduleBackgroundRefresh`
  registers the wake-up, and the package's `ReactWatchAppDelegate` forwards
  the fired `WKApplicationRefreshBackgroundTask` to JS's
  `onBackgroundRefresh` (with your userInfo). It needs the delegate adaptor
  in your `@main` App — `@WKApplicationDelegateAdaptor(ReactWatchAppDelegate.self)`
  — which `react-native-watchos scaffold` writes for you. Keep the handler
  short; the app suspends again when it returns.
- **Extended runtime sessions** require the consumer to declare the session
  reason in the target's Info.plist; without it the system invalidates the
  session immediately, which surfaces as a `runtimeSession.state` event with
  `state: "invalidated"`.

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
