# react-native-watchos

A custom React renderer for **Apple Watch**: write watch UI in JSX, run React
in QuickJS *on the watch*, and render to native SwiftUI. Not a fork of React
Native — a `react-reconciler` renderer that does the same category of thing
(JS engine on device + JSX/hooks + native widgets + an event bridge).

See the [project README](../README.md) for the full architecture, the Swift
host (`../swift`, a SwiftPM package), and the macOS build steps.

## Install

`react` and `react-reconciler` are **peer dependencies** — your app provides
the single copy (two copies silently break hooks/context):

```sh
npm i react-native-watchos react react-reconciler
```

Inside this monorepo, consume it as `workspace:*` from
`projects/react-native-watchos/js`. The npm command above is the intended shape
for external consumers once the package is published.

The package ships **source** (`exports` point at `src/*.ts`): it's bundle-only —
you always compile it into a QuickJS watch bundle with the
[`/build` preset](#subpath-exports), so there's no build step to run on install.
Any bundler (esbuild/Metro/vite) transpiles the TypeScript directly.

## Use

```tsx
import { runApp, VStack, Text, Button, getHost } from "react-native-watchos";

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

### Subpath exports

- `react-native-watchos/build` — `watchBuildOptions({ entry, outfile })`, the
  QuickJS-correct esbuild preset (shim inject, `es2020`, neutral IIFE), so you
  don't copy the bundle config.
- `react-native-watchos/testing` — `findByType` / `findByText` for asserting
  on committed trees with `runApp(element, new MemoryHost())`.

## React dedupe (single instance)

Inside this repo's pnpm workspace, `workspace:*` dedupes React automatically.
Consuming from **outside** the workspace (a `file:`/`link:` dependency, which
resolves via realpath) needs three settings — esbuild `nodePaths`, vitest
`resolve.dedupe`, and tsc `preserveSymlinks: true` — see
[From outside the workspace](../README.md#from-outside-the-workspace) in the
project README.

## Docs

- [How updates commit + serialization quirks](../docs/updates.md)
- [Adding a native capability](../docs/extending.md)
- [Roadmap](../docs/roadmap.md)
