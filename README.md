# react-watchos

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
SwiftUI-like, all 41 primitives: `VStack`, `HStack`, `ZStack`, `ScrollView`,
`List`, `TabView`, `Spacer`, `Divider`, `Text`, `TimerText`, `FormattedText`,
`Image`, `Map`,
`Gauge`, `ProgressView`, `Button`, `Toggle`, `Slider`, `Stepper`, `Picker`,
`DatePicker`, `TextField`, `SecureField`, `CrownRotation`, `NavigationStack`,
`NavigationLink`, `NavigationRoute`, `Alert`, `AlertAction`,
`ConfirmationDialog`, `Sheet`, `Section`, `Label`, `Grid`, `GridRow`,
`ShareLink`, `Chart`, `LabeledContent`, `ContentUnavailable`, `Toolbar`,
`ToolbarItem` — with SwiftUI layout rather than flexbox. Beyond views there's
`Storage` (App Group UserDefaults), `fetch` (WHATWG subset over native
URLSession), sensors (heart rate / motion / gyroscope / location via
HealthKit + CoreMotion push streams), a BLE central (`bleConnect` /
`bleWrite` / `bleSubscribe` + state/notify pushes), `sendToPhone`
(WatchConnectivity, watch side), `playHaptic`, `playAudio`,
`scheduleNotification` (local notifications with permission request and
cancel), `registerNativeListener` (instant native→React pushes),
`getDeviceInfo` (+ accessibility state, Water Lock), `Keychain`, `speak`
(TTS), `scheduleBackgroundRefresh`, extended-runtime sessions, StoreKit 2
in-app purchase, widget timelines, and control intents — all bridged through
the same registered-message host surface. Per-capability status with its
evidence level (Linux-tested → watch-compiled → simulator-verified) lives in
[docs/status.md](./docs/status.md); everything here is simulator-grade until
the device pass.

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

## Theming (semantic tokens)

Tokens resolve in JS — the wire and the Swift interpreter only ever see
concrete values, so theming needs no native code and is fully testable off-
device. `defaultTheme` uses SwiftUI semantic colors + Dynamic-Type text
styles, so zero config already looks native; `createTheme` overrides one
section at a time.

```tsx
const t = useTheme(); // wrap the app in <ThemeProvider theme={createTheme(...)}> to customize
<VStack spacing={t.space.sm} padding={t.space.md}
        background={t.colors.surface} cornerRadius={t.radius.md}>
  <Text {...t.text.title}>Water</Text>
  <Text {...t.text.muted}>2 of 8 glasses</Text>
</VStack>
```

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
can publish `url: deepLinkURL("/hydration")`; WidgetKit installs it as
`.widgetURL`, the watch host forwards `.onOpenURL` to JS as `openURL`, and
`NavigationProvider` maps it back to `["/hydration"]`.

**One scheme, no double-config.** The config plugin registers the deep-link
scheme in the watch target's `CFBundleURLTypes`, defaulting to your app's
bundle id (like the App Group) so two apps that both embed this library never
collide on a shared `reactwatch://`. The native host surfaces that exact scheme
to JS (`globalThis.__urlScheme`), so `deepLinkURL()` builds URLs and
`NavigationProvider` parses them from the *same* value — you don't set the
scheme a second time in JS. Override the default with the plugin's `scheme`
option for a shorter custom scheme; `deepLinkURL()`/`getURLScheme()` follow it
automatically.

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
      url: deepLinkURL("/hydration"),
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
| `js/` | The renderer + demo app (pure TypeScript, tested on any OS) **and** the SwiftPM host under `js/swift/` — both ship in one npm package. |
| `js/swift/` | The Swift host as a **SwiftPM package**: `CQuickJS` (quickjs-ng as a Clang module), `ReactWatchCore` (codegen'd wire models), `ReactWatchSupport` (Foundation platform logic — storage/optimistic/notifications), `ReactWatchRuntime` (the QuickJS embedding) — all Linux-built + `swift test`ed — plus two macOS-gated products: `ReactWatchHost` (SwiftUI interpreter + bridges + `ReactWatchRootView`) and `ReactWatchWidget` (WidgetKit infra: timeline providers + the extension's QuickJS runtime). |
| `app/` | Expo SDK 56 iOS shell; the watch app is a [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets) target that depends on the `js/swift/` package and is a thin `@main`. |
| `app/targets/widget/` | WidgetKit extension: decodes React-rendered timelines from App Group storage (`ReactWidgets.swift`, `WidgetNodeView.swift`); imports `ReactWatchCore`. |
| `examples/` | External-consumer templates (`minimal-watch-app`, `expo-watch-app`), each a workspace member. |
| `tools/embed-smoke/` | Reference C host: compiles the package's quickjs-ng and runs the real bundle through the exact API sequence Swift uses. |
| `tools/qjs-compile/` | Compiles the bundle to QuickJS bytecode (`bundle.qbc`) with the *vendored* engine, so the shipped bytecode version always matches the runtime; the watch app + widget prefer it over the source (`pnpm build:bytecode`, wired into `prebuild`). |
| `js/swift/Tests/` | The package's `swift test` wire-contract tests: decode real serializer fixtures with the codegen'd `ReactWatchCore` models on Linux. |
| `docs/api/` | **Generated API reference** (M12) — every export + type from the TS source via typedoc (`pnpm docs:api`), plus `capabilities.md`, the component/host-method tables emitted from `codegen/schema.ts` so they can't drift. |
| `docs/README.md` | **Docs index + current improvement plan** — start here for reviews, the verified backlog, and the architecture decisions. |
| `docs/research.md` | Why RN-core-on-watchOS is impossible; engine and architecture comparison. |
| `docs/prior-art.md` | Where this sits among production React renderers (RN, Raycast, r3f, Ink, …) and which techniques we adopt/skip/defer. |
| `docs/roadmap.md` | Forward plan in three parallel tracks (input, runtime, platform) with priorities, dependencies, and the Mac-build gate. |

## How to run

### JS side — works on Linux/macOS/anywhere

This project is a **pnpm workspace** (`js` = the renderer, `examples/*` =
consumer apps, `app` = the reference watch app). Run from the project root:

```bash
pnpm install                                 # one install for every member
pnpm --filter react-watchos test      # full suite, incl. real qjs smoke
pnpm --filter react-watchos typecheck  # strict tsc: src + tests
pnpm --filter react-watchos lint       # Biome (CI gate)
pnpm --filter react-watchos codegen    # Swift models + TS wire types
pnpm --filter react-watchos build      # bundle → both targets' assets/
pnpm --filter react-watchos build:bytecode  # precompile bundle.qbc
pnpm --filter react-watchos dev        # live reload on 127.0.0.1:8788
```

The demo's **Updates** screen reads `REACT_WATCH_OTA_URL` at build time. It is
the **manifest** URL — `checkForUpdate` fetches the JSON manifest and resolves
the bundle relative to it (so a `…/manifest.json` URL loads `…/bundle.js` from
the same directory). The dev server serves `dist/` statically, so both are
available. Point it at `manifest.json`, not the bundle:

```bash
# Simulator: localhost works.
REACT_WATCH_OTA_URL=http://127.0.0.1:8788/manifest.json \
  pnpm --filter react-watchos build

# Physical watch: bind the dev server to LAN and use your Mac's Wi-Fi IP.
DEV_HOST=0.0.0.0 pnpm --filter react-watchos dev
REACT_WATCH_OTA_URL=http://192.168.x.y:8788/manifest.json \
  pnpm --filter react-watchos build
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
import { runApp, VStack, Text, Button, getHost } from "react-watchos";
import { findByType } from "react-watchos/testing";   // tree queries
import { watchBuildOptions } from "react-watchos/build"; // esbuild preset
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

**Native setup (Expo plugin + scaffold)** — no manual Xcode wiring, and no
hand-written target config (the plugin composes apple-targets internally and
*generates* the `expo-target.config.js` files — don't create them yourself):

1. `npx expo install react-watchos @bacons/apple-targets`
2. Add the `react-watchos` plugin to `app.json` — the ONLY plugin entry you
   need; do not also list apple-targets. Options inline:

   ```jsonc
   "plugins": [["react-watchos", { "name": "My Watch", "widget": true }]]
   ```

   (See [`examples/expo-watch-app/app.json`](./examples/expo-watch-app/app.json)
   for the working reference.)
3. `npx react-watchos scaffold` writes the `@main` Swift glue the plugin
   can't generate (`targets/watch/WatchApp.swift`, plus the widget bundle when
   the widget target is enabled).
4. `npx expo prebuild` — the plugin generates the target configs, creates the
   targets via apple-targets, links the SwiftPM products, and merges each
   target's Info.plist in one pass (no post-prebuild step).
5. Build your watch JS with the preset (`watchBuildOptions`) into the target's
   assets; ship OTA updates by signing the manifest with `signManifest` from
   `react-watchos/manifest`.

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

**The source-shipping tsconfig contract (applies to EVERY consumer, registry
installs included):** because you compile our `.ts` as part of your program,
`skipLibCheck` does not exempt it — your tsconfig must be able to type-check
it. Concretely, the renderer source references Node-typed globals
(`setTimeout`, `console`, `process` guards), so a strict consumer needs
`@types/node` visible:

```jsonc
// tsconfig.json — required for every consumer of this package
{ "compilerOptions": { "types": ["node"] } }
```

and `@types/node` in your devDependencies (Expo templates already have it).
Without it, a strict config fails with ~25 `TS2304/TS2580` errors *inside the
package*. Both in-repo examples carry this setting.

A linked package additionally resolves through a symlink (realpath), so for
`file:`/`link:` your tools also need to dedupe React across that boundary.
Three settings, and that's the whole integration (not needed for a registry
install):

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
breaks hooks). Published to a registry (a normal `npm i`, no symlink) only the
`types: ["node"]` contract above applies — the symlink settings are specific
to linked local packages.

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
  concurrency) with `-warnings-as-errors`. Codegen formats generated Swift
  with Apple's `swift format` (`.swift-format`); the macOS workflow
  additionally lints with SwiftFormat + SwiftLint (`.swiftlint.yml`) —
  SourceKit isn't available on the Linux CI.

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
pnpm install                              # workspace install (every member)
pnpm --filter react-watchos build  # produce the JS bundle
# set your team id in app/app.json ("appleTeamId")
cd app && npx expo prebuild -p ios --clean  # generates ios/ with the watch target
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

- The watch target depends on the `js/swift/` SwiftPM package. The unified
  `react-watchos` config plugin (its `app.plugin.js` entry) writes the
  SwiftPM references into the generated watch/widget targets **during**
  `expo prebuild` — via a base mod that runs after apple-targets has created the
  targets (apple-targets/node-xcode have no local-package API, so it edits the
  pbxproj directly). There is no separate post-prebuild step, and a genuine link
  failure now fails the prebuild loudly rather than being swallowed. If it didn't
  apply, add it in Xcode (File ▸ Add Package Dependencies ▸ Add Local ▸
  `js/swift/`) and link **ReactWatchHost** to the watch target, **ReactWatchWidget**
  + **ReactWatchCore** to the widget (ReactWatchWidget pulls in
  Support/Runtime transitively). The engine is a Clang module
  (`import CQuickJS`) — no bridging header.
- Confirm `assets/bundle.js` landed in the watch target's bundle resources.
- `WKRunsIndependentlyOfCompanionApp` (standalone watch app) is set by the
  plugin by default (`independent` option) and applied by the same in-prebuild
  Info.plist merge — for a companion-dependent watch app pass `independent:
  false`. ⚠️ Independence is irreversible after your first App Store upload, so
  choose before submitting (see docs/publishing.md).
- App Groups: both the watch and widget targets must have the
  `group.com.emindeniz99.reactwatch` App Group capability (declared in
  their `expo-target.config.js`; verify under Signing & Capabilities, and
  register the group id for your team).

## Limitations (honest list)

- **Not RN core.** No RN components, no RN ecosystem libraries, no Yoga
  flexbox. Forty SwiftUI-like primitives, each accepting shared
  layout-modifier props (`padding`, `frame`, `background`,
  `cornerRadius`, `opacity`, `tint`, per-node `animation`, and stack
  `alignment`).
- **Controls require watchOS 26**; gated with `#available`, everything
  else runs on watchOS 10+.
- **No `Intl`.** QuickJS ships without the ECMAScript i18n API —
  `toLocaleString`/`toLocaleDateString` render a hardcoded US-style format,
  and there's no `Intl.NumberFormat`/`DateTimeFormat`. Instead of shipping
  ICU, hand native the declarative target: **`<FormattedText>`** renders a
  date (`date` + `dateStyle`/`timeStyle`) or a number (`value` +
  `format: "decimal" | "percent" | "currency"`) with the device locale via
  `DateFormatter`/`NumberFormatter` — the same philosophy as `<TimerText>`.
  For message translation, `createTranslations({ resources, fallbackLanguage,
  language })` + `<TranslationProvider>` / `useTranslation()` give a typed
  `t("key", { name })` with `{placeholder}` interpolation and a pluralization
  seam — plain data + one context, resolved in JS so the wire never sees a
  key, exactly like the theme layer. Feed it `getDeviceInfo().language`. The
  default plural rule is English `one`/`other` (zero-dependency, lean); for
  correct plurals in Arabic/Slavic/etc. pass **`pluralRule: cldrPluralRule`**
  (canonical CLDR for all ~220 languages via `plurals-cldr`, ~2.7 KB gz, no
  `Intl` — it tree-shakes out unless you import it). We compared against
  react-i18next / react-intl / Lingui first: all hard-depend on
  `Intl.PluralRules`, which QuickJS lacks, so a hand-rolled layer + the one
  CLDR data table is the right fit here (see `src/i18n.tsx` for the full
  rationale).
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
- Demo app bundle is ~565KB unminified / ~179KB minified (CI enforces a
  200KB minified budget; the widget bundle is 145KB against 160KB);
  QuickJS itself adds ~1MB of code — comfortably inside the watch app
  budget. (Point-in-time numbers, 2026-07-04 — the budget check is the
  enforced truth.)

## Versioning & stability

- **Pre-1.0 (`0.x`): every release may break.** Nothing has shipped to a
  store yet and the project deliberately prefers clean breaking changes over
  compatibility shims — pin an **exact** version (`"react-watchos": "0.1.0"`,
  no `^`/`~`) and read the changelog before upgrading.
- **OTA bundles are coupled to the native binary** — the fact that bites
  adopters: a served bundle must match the binary's wire version (`tree.v`),
  bridge protocol / capability features (ARCH-01), and signing scheme
  (currently `v2`). Upgrading `react-watchos` in your app and shipping a new
  binary **strands previously published OTA bundles**: an old-wire bundle is
  refused at commit time (the wire-version reject feeds the crash-loop
  counter, so devices self-heal to the shipped bundle rather than brick —
  but they silently stop taking that OTA). **Ship a rebuilt + re-signed OTA
  bundle together with every app-binary release that upgrades this library.**
- **Signature scheme changes require re-signing.** `v1 → v2` (signed expiry)
  already happened pre-release; when the scheme changes, every served
  manifest/bundle must be re-signed or the fleet refuses it.
- **Post-1.0 intent:** semver, where a change to the wire version, the bridge
  protocol, or the signing scheme is by definition a **major**.

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
  (`scripts/config.ts`), not by import-order convention.
- The build runs the **React Compiler** (`babel-plugin-react-compiler`) —
  a published preset flag, so consumers get it too:
  `watchBuildOptions({ reactCompiler: true })` (needs the Babel dev deps —
  see `esbuild/react-compiler.mjs`; the demo and the expo example both
  enable it). Auto-memoization means React re-renders less and emits fewer
  commits — fewer serialize/decode trips across the bridge, compounding
  with the renderer's wire-identical commit skip. React 19 ships the
  compiler runtime, so it adds ~7 KB minified and no new runtime dependency.
- `npm run build:bytecode` precompiles the bundle to QuickJS bytecode
  (`bundle.qbc`) so cold start skips the parser — the watch-sized analog of
  Hermes AOT. The watch/widget runtimes load `.qbc` if present and fall back
  to parsing `.js`. Trade-offs: bytecode is ~4× larger on disk (~2 MB vs
  ~480 KB) and is coupled to the vendored quickjs-ng version, so it's a
  build artifact (git-ignored), regenerated from the vendored sources at
  package time — never committed.
- The JS↔Swift wire model and `__host` surface are generated from one
  schema (`js/codegen/schema.ts`) into the Swift models and TS types; a
  drift test and a host-method cross-check keep the two languages in sync.
- **Threading.** QuickJS runs on the main thread; committed trees are
  decoded on a serial background queue (`decodeQueue`) and only `@Published`
  state is touched back on main, so the JSON-parse cost of large trees
  doesn't block the UI. Running the JS engine itself off the main thread
  (RN's JS-thread model) is deferred: it's a Swift-6 actor-isolation–
  sensitive change that can't be verified in this Linux environment, and at
  watch-tree scale the engine work is sub-millisecond. Revisit once the
  macOS build can compile/run it.
- Since shipped (this list used to call them "future"): WatchConnectivity on
  the watch side (`sendToPhone` + phone→watch pushes — the iPhone companion's
  WCSession wiring is what remains), minified bundles (`build:min` + the CI
  size budget), and QuickJS inside the widget extension for app-closed
  timeline refreshes (`WidgetIntentRuntime`). Still future: Hermes if it ever
  grows a watchOS target.
