# react-watchos

A custom React renderer for **Apple Watch**: write watch UI in JSX, run React
in QuickJS *on the watch*, and render to native SwiftUI. Not a fork of React
Native — a `react-reconciler` renderer that does the same category of thing
(JS engine on device + JSX/hooks + native widgets + an event bridge).

See the [project README](../README.md) for the architecture and the honest
limitations, and [docs/getting-started.md](../docs/getting-started.md) for the
Swift host (`../swift`, a SwiftPM package) and the macOS build steps.

## Install

`react` and `react-reconciler` are **peer dependencies** — your app provides
the single copy (two copies silently break hooks/context):

```sh
npm i react-watchos react react-reconciler
```

Inside this repo's pnpm workspace, consume it as `workspace:*` from `js/`.
The npm command above is the intended shape for external consumers once the
package is published.

The package ships **source** (`exports` point at `src/*.ts`): it's bundle-only —
you always compile it into a QuickJS watch bundle with the
[`/build` preset](#subpath-exports), so there's no build step to run on install.
Any bundler (esbuild/Metro/vite) transpiles the TypeScript directly.

## Use

```tsx
import { runApp, VStack, Text, Button, getHost } from "react-watchos";

function App() {
  const [n, setN] = useState(0);
  return (
    <VStack spacing={6}>
      <Text bold>Count: {n}</Text>
      <Button onPress={() => setN((c) => c + 1)}><Text>+</Text></Button>
    </VStack>
  );
}
runApp(<App />);
```

### Navigation

Screens are declared with stable paths and links point to those paths:

```tsx
function Routes() {
  const { path, setPath } = useNavigation();
  return (
    <NavigationStack path={path} onPathChange={setPath}>
      <NavigationRoute path="/" title="Home">
        <NavigationLink to="/hydration" label="Hydration" />
      </NavigationRoute>
      <NavigationRoute path="/hydration" title="Hydration">
        <HydrationScreen />
      </NavigationRoute>
    </NavigationStack>
  );
}

<NavigationProvider>
  <Routes />
</NavigationProvider>;
```

Use `children` on `NavigationLink` for a custom tappable label. Use
`useNavigate()` for imperative navigation. Widget/deep-link URLs such as
`reactwatch://hydration` are handled by `NavigationProvider`.

Paths may carry dynamic segments, Next.js/Expo style — `[id]` (one segment),
`[...rest]` (a catch-all of one or more), and `[[...rest]]` (optional). One
route handles every concrete path under it; `useParams()` reads the matched
segments, and a concrete route always wins over a catch-all that also matches:

```tsx
<NavigationStack path={path} onPathChange={setPath}>
  <NavigationRoute path="/lists" title="Shopping">
    <NavigationLink to="/list/groceries" label="Groceries" />
  </NavigationRoute>
  <NavigationRoute path="/list/[id]" title="List">
    <ListScreen />
  </NavigationRoute>
</NavigationStack>;

function ListScreen() {
  const { id } = useParams<{ id: string }>(); // "/list/groceries" -> "groceries"
  // ...
}
```

### Widgets (complications, Smart Stack, controls)

Widgets are React too: the watch app renders timelines ahead of time and
publishes them to the shared App Group; the widget extension renders the stored
tree natively. A widget is **two bundles** (the app UI and the widget) — the
widget bundle registers widgets/intents and never mounts UI, so the extension
process stays small.

**1. Widget JS entry** (`widget.entry.tsx`) — `registerWidget`, no `runApp`:

```tsx
import { registerWidget, VStack, Text } from "react-watchos";

registerWidget({
  kind: "example", // matches the Swift widget's `kind`
  families: ["accessoryRectangular", "accessoryCircular"],
  render: ({ now }) => ({
    entries: [{ date: now, view: <VStack><Text bold>Hi</Text></VStack> }],
  }),
});
```

**2. Build it** alongside the watch bundle. `buildBundles` builds every target
through the preset in one call — so a widget app's build script is the two
bundles' entry/outfile, no esbuild boilerplate per target:

```js
import { buildBundles } from "react-watchos/build";
await buildBundles([
  { name: "watch", entry: "watch-ui/entry.tsx", outfile: "targets/watch/assets/bundle.js",
    manifest: { version: 1, requiredFeatures: ["widgets"] } }, // app bundle: stamp OTA manifest
  { name: "widget", entry: "watch-ui/widget.entry.tsx", outfile: "targets/widget/assets/bundle.js" },
]);
```

(For full control over the esbuild call, `watchBuildOptions({ entry, outfile })`
returns the options and you run your own `esbuild.build` — `buildBundles` is the
batteries-included wrapper around it.)

**3. Swift glue** — `npx react-watchos scaffold` generates
`targets/widget/ReactWidgets.swift` (a `@main WidgetBundle` whose widgets render
through the package's `ReactTimelineProvider` + `reactWidgetView`). Enable the
widget target in the plugin (`["react-watchos", { "widget": true }]`);
`expo prebuild` then links the `ReactWatchWidget` SwiftPM module automatically.
Configurable widgets (a picker on the watch face) write their own
`AppIntentTimelineProvider` on the package's `reactTimeline`/`reactSnapshotEntry`
helpers — see the demo (`app/targets/widget`).

### Remote push (APNs)

The watch registers for its OWN device token — send pushes to it directly,
even with the iPhone away. Ask for notification permission first if you want
alerts to be visible (without it, pushes are delivered silently), then
register every launch (tokens are variable length and can rotate — never
cache one across launches):

```tsx
import {
  onRemotePush,
  registerForRemoteNotifications,
  requestNotificationPermission,
} from "react-watchos";

await requestNotificationPermission(); // visible alerts need this
const token = await registerForRemoteNotifications(); // lowercase hex
await fetch("https://api.example.com/devices", {
  method: "POST",
  body: JSON.stringify({ watchToken: token }),
});

onRemotePush(({ aps, ...custom }) => {
  // Fires for delivered pushes, including background
  // (`content-available: 1`) ones. A registered listener is what makes
  // the delegate report "new data" to watchOS.
});
```

Notes:

- **Delegate wiring**: scaffolded apps already wire `ReactWatchAppDelegate`,
  which forwards the token/failure/receive callbacks. An app with its own
  `WKApplicationDelegate` forwards the three calls to `ReactWatchRemotePush`
  (`didRegister(deviceToken:)`, `didFail(error:)`, `didReceive(_:)` — pass the
  last one's return value to the completion handler).
- **Entitlement**: APNs registration needs the `aps-environment` entitlement —
  set `push: true` in the plugin options (adds `"aps-environment":
  "development"`; release signing rewrites it to `"production"` from the
  provisioning profile), or turn on the Push Notifications capability in Xcode.
  Without it, `registerForRemoteNotifications()` rejects `UNAVAILABLE`.
- **Send to both tokens**: for a standalone-capable app, Apple's guidance is to
  send each push to BOTH the watch token and the paired-iPhone token — the
  system delivers it to the right place and dedupes.
- **Background pushes** (`content-available: 1`) wake the app briefly and are
  low-priority + system-budgeted. v1 limitation: a background push arriving
  before the JS bundle has booted (cold launch) is reported as "no data" and
  dropped — design your server to tolerate that (state sync over one-shot
  payloads).
- **Registration failures** reject the promise and also fire
  `onRemotePushRegistrationError`; unsolicited token rotations fire
  `onRemotePushToken`.
- **HostPolicy**: remote push is its own `"push"` feature — a consumer's
  `HostPolicy` allowlist that omits it makes `registerForRemoteNotifications()`
  reject `POLICY_DENIED` (local `notifications` does not imply remote push).

### Subpath exports

- `react-watchos/build` — `watchBuildOptions({ entry, outfile })`, the
  QuickJS-correct esbuild preset (shim inject, `es2020`, neutral IIFE), so you
  don't copy the bundle config; and `buildBundles([…])`, which builds multiple
  targets (watch + widget) through that preset in one call — each target may add
  a `define`, esbuild `plugins` (e.g. the React Compiler), and an OTA `manifest`.
  `buildBundles` needs `esbuild` installed (optional peer); reach for
  `watchBuildOptions` directly only to hand-assemble the esbuild options.
- `react-watchos/manifest` — `writeOTAManifest({ distDir, version, … })`,
  the OTA `manifest.json` stamper (also used by `buildBundles`' `manifest`).
- `react-watchos/testing` — `findByType` / `findByText` for asserting
  on committed trees with `runApp(element, new MemoryHost())`.

## Dev loop (hot restart + inspector)

Ships as CLI subcommands (M11) — a registry install gets the same loop the
demo uses:

```sh
npx react-watchos dev --entry watch-ui/entry.tsx        # live-reload server
npx react-watchos inspector                             # live tree/log/error UI
npx react-watchos build --entry watch-ui/entry.tsx \
  --asset targets/watch/assets/bundle.js                # one-shot build + copy
```

**The polling contract:** a DEBUG watch build polls
`http://127.0.0.1:8788/bundle.js` every 2 seconds and hot-restarts its QuickJS
runtime when the bytes change. `dev` serves exactly that URL; the watch
simulator shares the Mac's network, so localhost works out of the box. For a
physical watch, run `dev --host 0.0.0.0` and set the **`ReactWatchDevServerURL`**
Info.plist key on the watch target (via the plugin's `infoPlist` option) to
`http://<your-mac-lan-ip>:8788/bundle.js`. Release builds compile the polling
out entirely (`#if DEBUG`).

`inspector` receives what a DEBUG build's `startInspector()` posts — the live
committed tree, `console.log` tee, and captured errors (with componentStack) —
at `http://127.0.0.1:8099`.

## Consumer tsconfig contract (source-shipping)

This package ships raw `.ts` — your compiler type-checks it as part of your
program (`skipLibCheck` doesn't exempt it). The source references Node-typed
globals, so every consumer needs `@types/node` in devDependencies and:

```jsonc
{ "compilerOptions": { "types": ["node"] } }
```

Without it, a strict tsconfig fails with `TS2304/TS2580` errors inside the
package (`setTimeout`, `process`, `console`).

Everything else needed to type-check the shipped source is handled for you: the
types for the untyped runtime/peer deps it imports (`plurals-cldr`,
`react-reconciler`) are pulled in as regular dependencies, and the timer-id
casts assert through `unknown` so `@types/node`'s `NodeJS.Timeout` return type
doesn't clash. A fresh consumer that installs the package + the `react` /
`react-reconciler` peers + `@types/node` gets a clean `tsc` — verified by
packing the tarball and type-checking a consumer app against it.

## React dedupe (single instance)

What dedupes React is **overlapping version ranges**, not `workspace:*` and not
the preset's `nodePaths` (an esbuild fallback, consulted only when normal
walk-up resolution fails). A `react` your app pins exactly next to a different
`react` the renderer resolves gives you two copies in one bundle even inside
this workspace — which is why every build through `watchBuildOptions` /
`buildBundles` fails loudly if the module graph contains more than one
(`esbuild/single-copy.mts`). Keep your `react` range overlapping the one
`react-watchos` resolves.

Consuming from **outside** the workspace (a `file:`/`link:` dependency, which
resolves via realpath) needs three settings — esbuild `nodePaths`, vitest
`resolve.dedupe`, and tsc `preserveSymlinks: true` — see
[From outside the workspace](../docs/getting-started.md#from-outside-the-workspace)
in the project docs.

## Docs

- [How updates commit + serialization quirks](../docs/updates.md)
- [Adding a native capability](../docs/extending.md)
- [Roadmap](../docs/roadmap.md)
