# minimal-watch-app

The smallest real app on the **react-native-watchos** engine, built the way an
*external* consumer builds — installing the package, not reaching into its
source. Use it as a starting template.

> **Using Expo?** Prefer [`../expo-watch-app`](../expo-watch-app): add the
> `react-native-watchos` config plugin, run `react-native-watchos scaffold`, and
> `expo prebuild` generates + links the watch target for you. This minimal
> example is the **non-Expo** shape — a JS bundle you embed in a hand-wired watch
> target (the manual steps below).

What it demonstrates (and what the demo doesn't):

- Importing UI + `runApp` from the package: `import { ... } from "react-native-watchos"`.
- Building with the **exported preset** (`react-native-watchos/build`) — no
  copied esbuild config. See [`scripts/build.mjs`](./scripts/build.mjs) (~10 lines).
- Testing with the **exported helpers** (`react-native-watchos/testing`) — no
  re-implemented `findByType`. See [`test/app.test.tsx`](./test/app.test.tsx).
- A `tsconfig.json` with **no `paths` mapping and no react type hand-mapping** —
  the package's `exports` map resolves everything.

## JS side (works on Linux/macOS)

```bash
pnpm install       # installs react + the renderer via the workspace dependency
pnpm typecheck
pnpm test          # runApp + MemoryHost + /testing query helpers
pnpm build         # dist/bundle.js (the IIFE the watch target evaluates)
```

`package.json` pulls the renderer in with a pnpm workspace dependency (a
non-workspace consumer would use a registry version, or `file:`/`link:` to a
local checkout):

```json
"dependencies": {
  "react": "^19.2.0",
  "react-reconciler": "0.33.0",
  "react-native-watchos": "workspace:*"
}
```

**React dedupe (important):** the renderer is a *peer* of react /
react-reconciler — your app provides the single copy. The build preset's
`nodePaths: [<your>/node_modules]` makes the renderer's own `react` imports
resolve to that copy; vitest's `resolve.dedupe` does the same for tests. Two
React copies silently break hooks/context.

## Watch target wiring (requires macOS 15+, Xcode 16+)

The renderer ships no native target — you embed the engine in your own watch
app (the `app/` project in this repo is the reference; `@bacons/apple-targets`
generates the target from Expo). The pieces a watch target needs:

1. **Bundle as a resource.** Copy `dist/bundle.js` to the watch target's
   `assets/bundle.js`; the Swift runtime evaluates it on launch. Rebuild the JS
   and re-copy (or script it) whenever the app changes.
2. **Standalone Info.plist key** so the watch app runs without the phone:
   `WKRunsIndependentlyOfCompanionApp = true`.
3. **App Group** (only if you use widgets/complications or shared storage):
   add `com.apple.security.application-groups` with your
   `group.<id>` to the watch *and* widget targets; it must match the Swift
   `SharedWidgetStore.appGroupId`.
4. **Usage-description keys** for any native capability you call —
   e.g. `NSBluetoothAlwaysUsageDescription` (BLE), `NSHealthShareUsageDescription`
   (heart rate). The renderer exposes the JS APIs; the OS needs the strings.
5. **Scheme:** build the watch app scheme to a watchOS simulator/device. With
   code signing disabled you can compile-check it in CI (see the repo's macOS
   workflow).

See the repo `README.md` and `app/targets/watch/` for a complete target,
and `docs/updates.md` for how React updates commit on-watch.
