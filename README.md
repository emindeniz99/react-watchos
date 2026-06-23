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
SwiftUI-like (`VStack`, `HStack`, `ZStack`, `Text`, `TimerText`, `Button`,
`Toggle`, `Spacer`, `Image`, `ScrollView`, `List`, `Divider`, `Gauge`,
`ProgressView`, `NavigationStack`, `NavigationRoute`, `NavigationLink`, `TextField`,
`Picker`, `TabView`), with SwiftUI layout rather than flexbox. Beyond
views there's `Storage` (App Group UserDefaults), `playHaptic`,
`scheduleNotification` (local notifications with permission request and
cancel), `registerNativeListener` (instant native→React pushes), widget
timelines, and control intents — all bridged through the same
registered-message host surface.

## Updating the UI: instant, periodic, smooth

The renderer is pull/event-driven — it commits only when something
re-enters JS, so it costs nothing while idle. Match the mechanism to the
update frequency:

- **Instant** (taps, native pushes): a tap runs at urgent priority and
  flushes synchronously, so the commit happens before the native call
  returns (latency ≈ one display frame). For native state that isn't a tap
  — connectivity, sensors, lifecycle — register a listener with
  `registerNativeListener(name, handler)` and have Swift call
  `model.pushNativeEvent(name, payload)`; it routes through `runSync` so it
  reacts instantly too, instead of on the scheduler's next turn. (Demo: the
  Stopwatch screen's `phase:` footer, pushed from `scenePhase`.)
- **Periodic** (seconds clock, polling): drive it from JS with
  `setTimeout`/`setInterval`, ideally aligned to the boundary.
- **Smooth / high-frequency** (stopwatch, countdown, animated timer): do
  **not** drive it from React — render `<TimerText since={startMs} />` or
  `<TimerText until={endMs} />` once and SwiftUI ticks the digits natively
  (`Text(timerInterval:)`), zero per-frame JS, even while the bundle is
  idle. For a paused value, render a plain `<Text>` with the frozen string.
  Same idea as the widget timelines: hand native the declarative target and
  let it run. (Demo: the Stopwatch screen.)

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

## Navigation & deep links

Navigation is route-first. Every navigable screen gets a stable path, and
links point to those paths. The Swift host still renders a native
`NavigationStack(path:)`, so pushes, back navigation, and watchOS-native
transitions stay native while React owns the route state.

```tsx
function App() {
  return (
    <NavigationProvider>
      <Routes />
    </NavigationProvider>
  );
}

function Routes() {
  const { path, setPath } = useNavigation();
  return (
    <NavigationStack path={path} onPathChange={setPath}>
      <NavigationRoute path="/" title="React Watch">
        <List>
          <NavigationLink to="/hydration" accessibilityLabel="Hydration">
            <HStack spacing={4}>
              <Image systemName="drop.fill" color="cyan" />
              <Text>Hydration</Text>
            </HStack>
          </NavigationLink>
          <NavigationLink to="/stopwatch" label="Stopwatch" />
        </List>
      </NavigationRoute>

      <NavigationRoute path="/hydration" title="Hydration">
        <HydrationScreen />
      </NavigationRoute>
      <NavigationRoute path="/stopwatch" title="Stopwatch">
        <StopwatchScreen />
      </NavigationRoute>
    </NavigationStack>
  );
}
```

`NavigationLink` requires `to`; `label` is the simple text form, and
children are the custom tappable label/content. Destination screens live in
`NavigationRoute`, never as `NavigationLink` children. For imperative flows
use `const navigate = useNavigate(); navigate("/hydration")`; use
`navigate("/", { action: "reset" })` to return to root.

The same route table handles external entry points. A widget timeline entry
can publish `url: "reactwatch://hydration"`; WidgetKit installs it as
`.widgetURL`, the watch host forwards `.onOpenURL` to JS as `openURL`, and
`NavigationProvider` maps it back to `["/hydration"]`. Consumers using a
custom scheme must register it in the watch target's `CFBundleURLTypes`
(the reference app's target config registers `reactwatch`).

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
    entries: [{
      date: now,
      url: "reactwatch://hydration",
      view: <Gauge value={glasses} max={8} label="Water" />,
    }],
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
| `swift/` | The Swift host as a **SwiftPM package**: `CQuickJS` (quickjs-ng as a Clang module), `ReactWatchCore` (codegen'd wire models), `ReactWatchSupport` (Foundation platform logic — storage/optimistic/notifications), `ReactWatchRuntime` (the QuickJS embedding) — all Linux-built + `swift test`ed — and `ReactWatchHost` (SwiftUI interpreter + bridges + `ReactWatchRootView`, macOS). |
| `app/` | Expo SDK 56 iOS shell; the watch app is a [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets) target that depends on the `swift/` package and is a thin `@main`. |
| `app/targets/widget/` | WidgetKit extension: decodes React-rendered timelines from App Group storage (`ReactWidgets.swift`, `WidgetNodeView.swift`); imports `ReactWatchCore`. |
| `examples/` | External-consumer templates (`minimal-watch-app`, `expo-watch-app`), each a workspace member. |
| `tools/embed-smoke/` | Reference C host: compiles the package's quickjs-ng and runs the real bundle through the exact API sequence Swift uses. |
| `swift/Tests/` | The package's `swift test` wire-contract tests: decode real serializer fixtures with the codegen'd `ReactWatchCore` models on Linux. |
| `docs/research.md` | Why RN-core-on-watchOS is impossible; engine and architecture comparison. |
| `docs/prior-art.md` | Where this sits among production React renderers (RN, Raycast, r3f, Ink, …) and which techniques we adopt/skip/defer. |
| `docs/roadmap.md` | Forward plan in three parallel tracks (input, runtime, platform) with priorities, dependencies, and the Mac-build gate. |

## How to run

### JS side — works on Linux/macOS/anywhere

This project is a **pnpm workspace** (`js` = the renderer, `examples/*` =
consumer apps, `app` = the reference watch app). Run from the project root:

```bash
pnpm install                                 # one install for every member
pnpm --filter react-native-watchos test      # full suite, incl. real qjs smoke
pnpm --filter react-native-watchos typecheck  # strict tsc: src + tests
pnpm --filter react-native-watchos lint       # Biome (CI gate)
pnpm --filter react-native-watchos codegen    # Swift models + TS wire types
pnpm --filter react-native-watchos build      # bundle → both targets' assets/
pnpm --filter react-native-watchos build:bytecode  # precompile bundle.qbc
pnpm --filter react-native-watchos dev        # live reload on 127.0.0.1:8788
```

The demo's **Updates** screen reads `REACT_WATCH_OTA_URL` at build time. For a
local OTA test, serve `dist/bundle.js` from your Mac and rebuild the demo with
the URL you want the watch to fetch:

```bash
# Simulator: localhost works.
REACT_WATCH_OTA_URL=http://127.0.0.1:8788/bundle.js \
  pnpm --filter react-native-watchos build

# Physical watch: bind the dev server to LAN and use your Mac's Wi-Fi IP.
DEV_HOST=0.0.0.0 pnpm --filter react-native-watchos dev
REACT_WATCH_OTA_URL=http://192.168.x.y:8788/bundle.js \
  pnpm --filter react-native-watchos build
```

> The generated `app/targets/*/assets/bundle.js` is **not** committed (it's
> gitignored). `pnpm --filter ... build` regenerates it, and `app`'s `prebuild`
> script runs that build first, so `pnpm prebuild` (and CI) always produce a
> fresh bundle before the Xcode build. Run `build` once before opening the
> Xcode project directly.

### Consuming it in your own app

The renderer is a real package: `exports` (main, `/build`, `/testing`),
`peerDependencies` for react / react-reconciler, and a typed host surface.

```ts
import { runApp, VStack, Text, Button, getHost } from "react-native-watchos";
import { findByType } from "react-native-watchos/testing";   // tree queries
import { watchBuildOptions } from "react-native-watchos/build"; // esbuild preset
```

- **Single React instance:** react / react-reconciler are peers — your app
  provides the one copy. In this workspace `workspace:*` dedupes it
  automatically; published, a normal install + the build preset's `nodePaths`
  does the same. Two copies silently break hooks/context.
- **No copied build config:** `watchBuildOptions({ entry, outfile })` is the
  QuickJS-correct esbuild preset (shim inject, es2020, neutral IIFE).
- **Extending natively:** `getHost()` + `QuickJSHostGlobal` are public — see
  [docs/extending.md](./docs/extending.md) for the "add a native capability"
  recipe, and [docs/updates.md](./docs/updates.md) for how updates commit.

Two worked examples (each its own workspace member, both verified on Linux):

- [`examples/minimal-watch-app`](./examples/minimal-watch-app) — the smallest
  consumer: watch UI only, imports the package, builds with the preset.
- [`examples/expo-watch-app`](./examples/expo-watch-app) — an Expo iPhone app
  that adds a watch target whose UI runs on this engine (the realistic shape).

#### From outside the workspace

The package ships **source** (no build step, no `prepare` hook), so consuming
it from outside the workspace — a different repo/folder linking it via
`file:`/`link:`, or a registry `npm i` — works without building anything: your
bundler compiles the `.ts` directly.

A linked package resolves through a symlink (realpath), so for `file:`/`link:`
your tools also need to dedupe React across that boundary. Three settings, and
that's the whole integration (none needed for a registry install):

```js
// esbuild build: resolve the renderer's `react` to YOUR copy
watchBuildOptions({ entry, outfile, nodePaths: [join(root, "node_modules")] });
```
```ts
// vitest.config.ts
export default defineConfig({ resolve: { dedupe: ["react", "react-reconciler"] } });
```
```jsonc
// tsconfig.json — the easy one to miss. Without it, tsc follows the symlink to
// the renderer's source and can't find its react, so type-checking fails.
{ "compilerOptions": { "preserveSymlinks": true } }
```

Without `preserveSymlinks`, `tsc` type-checks the renderer's `.ts` source at
its real path (outside your `node_modules`) and can't resolve `react` there.
The first two prevent a second React copy in the bundle/tests (which silently
breaks hooks). Published to a registry (a normal `npm i`, no symlink) none of
this is needed — it's specific to linked local packages.

### Type safety & linting

- **TypeScript** runs at maximum strictness. `tsconfig.base.json` enables
  `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`/`Returns`, `noFallthroughCasesInSwitch`,
  `noUnused*`, `verbatimModuleSyntax`, and `allowUnreachableCode: false`.
  `tsconfig.json` (production: `src`/`demo`/`scripts`/`codegen`) inherits all
  of it; `tsconfig.test.json` inherits everything **except**
  `noUncheckedIndexedAccess`, which is pure noise when asserting on
  just-built fixtures. `npm run typecheck` checks both.
- **Biome** is the linter + formatter (`biome.json`): recommended rules,
  double quotes, 2-space, 80 cols, organized imports. Generated wire types
  are excluded so it never fights codegen. Non-null assertions and `any` are
  allowed only under `test/**`.
- **Swift** contract tests build in Swift 6 language mode (strict
  concurrency) with `-warnings-as-errors`. `.swiftformat` + `.swiftlint.yml`
  cover the watch/widget targets and run on the macOS workflow (SourceKit
  isn't available on the Linux CI).

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

**First-build friction (verified on the watchOS simulator; physical-device
signing still untested — Rule 12):**

- The watch target depends on the local `swift/` SwiftPM package. The
  `with-react-watch-package.js` config plugin writes the SwiftPM references
  into the generated watch/widget targets during `expo prebuild` (best-effort,
  and wrapped so it can't fail prebuild — apple-targets/node-xcode have no
  local-package API, so it edits the pbxproj directly). If it didn't apply, add
  it in Xcode (File ▸ Add Package Dependencies ▸ Add Local ▸ `swift/`) and link
  **ReactWatchHost** to the watch target, **ReactWatchCore** +
  **ReactWatchSupport** + **ReactWatchRuntime** to the widget. The engine is a Clang module
  (`import CQuickJS`) — no bridging header.
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
  state to hide the JS round-trip, released by a seq-ack protocol —
  every dispatch carries a sequence number, every commit acks the
  highest one processed (`tree.seq`, with a guaranteed ack commit even
  when React doesn't re-render), so rapid interactions can't snap back
  to stale values.
- **Physical-device path unverified.** The Swift side compiles and runs on
  the **watchOS simulator** (Xcode build succeeds, the app renders, and the
  package tests pass on the watch arch via `xcodebuild test`), and the
  JS↔engine contract is pinned by tests (vitest + real `qjs` + the C
  reference host). What's still unexercised is a real watch + code signing
  (App Groups, `WKRunsIndependentlyOfCompanionApp` on hardware).
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
  so React's scheduler captures `setTimeout` at module init — the QuickJS
  shims are therefore force-prepended via esbuild's `inject` option
  (`scripts/config.mjs`), not by import-order convention.
- The build runs the **React Compiler** (`babel-plugin-react-compiler`) over
  our source via an esbuild plugin (`scripts/react-compiler-plugin.mjs`).
  Auto-memoization means React re-renders less and emits fewer commits —
  fewer serialize/decode trips across the bridge, compounding with the
  renderer's no-op-commit bailout. React 19 ships the compiler runtime, so
  it adds ~7 KB minified and no new runtime dependency.
- `npm run build:bytecode` precompiles the bundle to QuickJS bytecode
  (`bundle.qbc`) so cold start skips the parser — the watch-sized analog of
  Hermes AOT. The watch/widget runtimes load `.qbc` if present and fall back
  to parsing `.js`. Trade-offs: bytecode is ~4× larger on disk (~2 MB vs
  ~480 KB) and is coupled to the vendored quickjs-ng version, so it's a
  build artifact (git-ignored), regenerated from the vendored sources at
  package time — never committed.
- The JS↔Swift wire model and `__host` surface are generated from one
  schema (`js/codegen/schema.mjs`) into the Swift models and TS types; a
  drift test and a host-method cross-check keep the two languages in sync.
- **Threading.** QuickJS runs on the main thread; committed trees are
  decoded on a serial background queue (`decodeQueue`) and only `@Published`
  state is touched back on main, so the JSON-parse cost of large trees
  doesn't block the UI. Running the JS engine itself off the main thread
  (RN's JS-thread model) is deferred: it's a Swift-6 actor-isolation–
  sensitive change that can't be verified in this Linux environment, and at
  watch-tree scale the engine work is sub-millisecond. Revisit once the
  macOS build can compile/run it.
- Future: WatchConnectivity data sync in the companion app, Hermes once
  it grows a watchOS target, minified bundles, QuickJS inside the widget
  extension for app-closed timeline refreshes.
