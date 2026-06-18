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

export function onTorchState(cb: (on: boolean) => void): void {
  registerNativeListener("torch", (p) => cb(Boolean((p as { on?: boolean })?.on)));
}
```

If you're adding the op to the renderer itself, declare it on
`QuickJSHostGlobal` (in `src/host.ts`) instead of the inline cast, and add it to
`codegen/schema.mjs`'s `hostMethods` so the Swift install is cross-checked.

**2. Swift side** installs the op and pushes events. In your watch runtime,
register a `torch` function on the `__host` object that does the native work,
and call `__pushNativeEvent("torch", "{\"on\":true}")` when state changes. (See
`app/targets/watch/JSRuntime.swift` + `SensorBridge.swift` for the pattern —
the bridges push via the same `__pushNativeEvent` entry point.)

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
