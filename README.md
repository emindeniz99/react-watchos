# react-native-watchos

## What it does

Write Apple Watch UI in React — JSX, hooks, state — rendered as **native
SwiftUI**, with the JS engine running **on the watch itself**. The app is
standalone: it installs, runs, and updates its UI without the iPhone.

```tsx
function App() {
  const [count, setCount] = useState(0);
  return (
    <VStack spacing={6}>
      <Text size={24} bold>Count: {count}</Text>
      <Button onPress={() => setCount((c) => c + 1)}>
        <Text>+</Text>
      </Button>
    </VStack>
  );
}
```

## Is this React Native?

In spirit, yes; in code, no. React Native = React + a native host platform
(Yoga layout, the Fabric renderer mapping the tree to UIKit/Android views,
JSI/TurboModules, Metro, `<View>`/`<Text>`/StyleSheet). A true RN port is
impossible on watchOS — there is no public UIKit and no JavaScriptCore for
Fabric/Hermes to attach to, which is why react-native-tvos exists but no
watch equivalent does ([docs/research.md](./docs/research.md) has the full
analysis).

This project does the same *category* of thing with ~500 lines instead of a
framework fork: a JS engine on the device, JSX + hooks driving real native
widgets, events bridged back to JS. It shares no code with RN core — RN
ecosystem libraries won't run here — and the component vocabulary is
SwiftUI-like (`VStack`, `HStack`, `ZStack`, `Text`, `Button`, `Toggle`,
`Spacer`, `Image`, `ScrollView`, `List`, `Divider`, `Gauge`,
`ProgressView`, `NavigationStack`, `NavigationLink`, `TextField`,
`Picker`, `TabView`), with SwiftUI layout rather than flexbox. Beyond
views there's `Storage` (App Group UserDefaults), `playHaptic`, widget
timelines, and control intents — all bridged through the same
registered-message host surface.

## Architecture

```
┌─ watchOS app (standalone SwiftUI) ──────────────────────────────┐
│                                                                  │
│  QuickJS (quickjs-ng, vendored C, compiled into the target)      │
│   ├── bundle.js = React 19 + react-reconciler + your JSX app     │
│   │   (esbuild single-file IIFE, shipped as an app resource)     │
│   ├── JS → Swift:  __host.commit(treeJSON) on every React commit │
│   │                __host.log / __host.setTimer                  │
│   └── Swift → JS:  __dispatchEvent(nodeId, event, payloadJSON)   │
│                    __fireTimer(id), pending-job drain            │
│                                                                  │
│  NodeView.swift: decodes {id, type, props, children} and renders │
│  real SwiftUI views; taps/toggles dispatch events back to React  │
└──────────────────────────────────────────────────────────────────┘
```

The custom renderer (`js/src/renderer.ts`, a `react-reconciler@0.33` host
config) serializes the full instance tree on every commit — watch screens
are tens of nodes, so diffing isn't worth a protocol. Function props cross
the bridge as `true` flags; node ids are stable, so native events target
live instances. Same producer/consumer pattern as
[react-ssd1306](https://github.com/doodlewind/react-ssd1306),
[react-tvml](https://github.com/sergioramos/react-tvml), and Raycast
(whose extension architecture is reviewed in
[docs/research.md](./docs/research.md)).

## Complications & widgets (React-authored)

Watch complications and Smart Stack widgets are WidgetKit accessory
widgets (ClockKit is deprecated). Widget extensions can't run a live app,
so the **watch app's React renders the timelines** and the extension only
displays them:

```tsx
registerWidget({
  kind: "hydration",
  families: ["accessoryCircular", "accessoryRectangular", "accessoryInline"],
  render: ({ family, now }) => ({
    entries: [{ date: now, view: <Gauge value={glasses} max={8} label="Water" /> }],
    reloadAfter: now + 24 * 3_600_000,
  }),
});
// after any state change:
publishWidgets();
```

`publishWidgets()` renders every (kind × family) timeline to serialized
trees and hands them to `__host.publishWidgets`, which writes App Group
storage and calls `WidgetCenter.reloadAllTimelines()`. The
`targets/widget` extension decodes the stored payload in its
`TimelineProvider` and renders it with a static interpreter
(`WidgetNodeView.swift`). The demo hydration tracker drives a circular
gauge complication, a corner gauge, a rectangular Smart Stack card, and
the inline text slot — all from one React render function.

The extension also embeds its own QuickJS (`IntentRuntime.swift`,
measured ~6MB peak vs the ~30MB widget budget, capped at 16MB):

- **Controls (watchOS 26)**: the "Add Glass" Control Center / Action
  button control runs an AppIntent that evaluates the bundle with
  `__entrypoint = "intent"` and dispatches to the handler registered via
  `registerIntent("addGlass", …)` — React updates shared Storage and
  republishes the complications without the app ever opening. Control
  label/symbol come from `registerControl(...)` metadata in the payload.
- **Self-refreshing timelines**: `getTimeline` prefers a fresh in-process
  React render (`__renderWidgets`) over the stored payload.
- **Timelines & relevance**: the daypart demo widget publishes
  future-dated entries (WidgetKit swaps them all day with no process
  running) plus Smart Stack relevance scores per entry.

## Layout

| Path | What |
|---|---|
| `js/` | The renderer + demo app. Pure TypeScript, fully tested on any OS. |
| `app/` | Expo SDK 56 iOS shell; the watch app is a [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets) target. |
| `app/targets/watch/` | Swift: `JSRuntime.swift` (QuickJS embed), `NodeView.swift` (SwiftUI interpreter), vendored quickjs-ng v0.10.1. |
| `app/targets/widget/` | WidgetKit extension: decodes React-rendered timelines from App Group storage (`ReactWidgets.swift`, `WidgetNodeView.swift`). |
| `tools/embed-smoke/` | Reference C host: compiles the vendored engine and runs the real bundle through the exact API sequence Swift uses. |
| `docs/research.md` | Why RN-core-on-watchOS is impossible; engine and architecture comparison. |

## How to run

### JS side — works on Linux/macOS/anywhere

```bash
cd js
npm install
npm test             # 48 tests, including smoke tests inside a real qjs binary
npm run build        # bundle → both targets' assets/ (470KB, readable traces)
npm run build:min    # minified (~139KB)
npm run dev          # live reload: esbuild watch+serve on 127.0.0.1:8788
```

With `npm run dev` running, DEBUG builds of the watch app poll the dev
server every 2s and hot-restart the QuickJS runtime when the bundle
changes — edit `demo/App.tsx` and the simulator updates without an
Xcode rebuild.

The qjs smoke test needs a `qjs` binary on PATH (`apt install quickjs` /
`brew install quickjs`). `tools/embed-smoke/run.sh` additionally compiles
the vendored quickjs-ng sources with a C host and runs the bundle through
the same embedding calls `JSRuntime.swift` makes.

### Watch app — requires macOS 15+, Xcode 16+

```bash
cd js && npm install && npm run build     # produce the JS bundle
cd ../app && npm install
# set your team id in app.json ("appleTeamId")
npx expo prebuild -p ios --clean          # generates ios/ with the watch target
xed ios                                   # open the workspace
```

In Xcode: select the **React Watch** scheme, choose a paired watch
simulator (or device), and run. Edit `js/demo/App.tsx`, re-run
`npm run build`, and rebuild the watch target to see changes. To see the
complications, add the Hydration complication to a watch face (or the
widget to the Smart Stack), then tap "Add glass" in the app — the gauge
updates via `publishWidgets()`.

**Expected first-build friction (untested on a real Mac — Rule 12):**

- If Swift can't see the QuickJS API, set the watch target's
  `SWIFT_OBJC_BRIDGING_HEADER` to
  `../targets/watch/Vendor/quickjs/quickjs-swift-shim.h` (path relative to
  the generated `ios/` project) and confirm the vendored `.c` files are in
  the target's Compile Sources.
- Confirm `assets/bundle.js` landed in the watch target's bundle resources.
- If prebuild didn't apply `WKRunsIndependentlyOfCompanionApp`, add it to
  the watch target's Info.plist.
- App Groups: both the watch and widget targets must have the
  `group.com.emindeniz99.reactwatch` App Group capability (declared in
  their `expo-target.config.js`; verify under Signing & Capabilities, and
  register the group id for your team).

## Limitations (honest list)

- **Not RN core.** No RN components, no RN ecosystem libraries, no Yoga
  flexbox. Eighteen SwiftUI-like primitives.
- **Controls require watchOS 26**; gated with `#available`, everything
  else runs on watchOS 10+.
- **Input round-trips**: Toggle/Picker/TextField keep optimistic local
  state to hide the JS round-trip; values reconcile on the next commit.
- **The Swift side has never been compiled** — this repo was built in a
  Linux environment without Xcode. The JS↔engine contract is pinned by
  tests (vitest + real `qjs` + the C reference host), but expect minor
  Xcode-side fixes.
- Interpreter speed (no JIT — Apple forbids it anyway). Fine for UI-sized
  work; don't mine bitcoin in `useEffect`.
- Full-tree commits: ideal for watch-sized screens; large lists would want
  the diffing optimization noted in docs/research.md.
- Bundle is ~460KB unminified (minify would roughly halve it); QuickJS
  itself adds ~1MB of code — comfortably inside the watch app budget.

## Notes / learnings

- React 19 + react-reconciler 0.33 run unmodified in QuickJS (even
  Bellard's 2021 build) once `queueMicrotask`/`setTimeout`/`console` shims
  exist — see `js/src/shims.ts`.
- React swallows render errors into `onUncaughtError` on concurrent roots;
  `WatchRoot` rethrows so a broken watch UI fails loudly.
- react-reconciler's host-config surface churns between minors — it is
  pinned exactly, and `js/test/render.test.tsx` locks the wire schema.
- The Espruino/Bangle.js community ran React for a 64KB watch by keeping
  React on the phone; Apple Watch has the RAM to skip the Bluetooth hop
  entirely.
- Raycast's extension pipeline (custom reconciler → JSON render tree →
  native views, registered-messages-only IPC) independently validates this
  architecture at scale; their tree-diffing and process isolation are the
  upgrades to reach for if trees grow or the JS becomes untrusted — see
  docs/research.md.
- esbuild evaluates imported module bodies before the entry's statements,
  so React's scheduler captures `setTimeout` at module init —
  `src/install-shims.ts` must stay the bundle's first import.
- Future: WatchConnectivity data sync in the companion app, Hermes once
  it grows a watchOS target, minified bundles, QuickJS inside the widget
  extension for app-closed timeline refreshes.
