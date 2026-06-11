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
SwiftUI-like (`VStack`, `HStack`, `Text`, `Button`, `Toggle`, `Spacer`,
`Image`), with SwiftUI stack layout rather than flexbox.

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
[react-tvml](https://github.com/sergioramos/react-tvml), and Raycast.

## Layout

| Path | What |
|---|---|
| `js/` | The renderer + demo app. Pure TypeScript, fully tested on any OS. |
| `app/` | Expo SDK 56 iOS shell; the watch app is a [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets) target. |
| `app/targets/watch/` | Swift: `JSRuntime.swift` (QuickJS embed), `NodeView.swift` (SwiftUI interpreter), vendored quickjs-ng v0.10.1. |
| `tools/embed-smoke/` | Reference C host: compiles the vendored engine and runs the real bundle through the exact API sequence Swift uses. |
| `docs/research.md` | Why RN-core-on-watchOS is impossible; engine and architecture comparison. |

## How to run

### JS side — works on Linux/macOS/anywhere

```bash
cd js
npm install
npm test        # 15 tests, including a smoke test inside a real qjs binary
npm run build   # dist/bundle.js → app/targets/watch/assets/bundle.js
```

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
`npm run build`, and rebuild the watch target to see changes.

**Expected first-build friction (untested on a real Mac — Rule 12):**

- If Swift can't see the QuickJS API, set the watch target's
  `SWIFT_OBJC_BRIDGING_HEADER` to
  `../targets/watch/Vendor/quickjs/quickjs-swift-shim.h` (path relative to
  the generated `ios/` project) and confirm the vendored `.c` files are in
  the target's Compile Sources.
- Confirm `assets/bundle.js` landed in the watch target's bundle resources.
- If prebuild didn't apply `WKRunsIndependentlyOfCompanionApp`, add it to
  the watch target's Info.plist.

## Limitations (honest list)

- **Not RN core.** No RN components, no RN ecosystem libraries, no Yoga
  flexbox. Seven SwiftUI-like primitives in v1.
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
- Future: WatchConnectivity data sync in the companion app, `List`/
  `ScrollView`/`NavigationStack` primitives, Hermes once it grows a
  watchOS target, minified bundles.
