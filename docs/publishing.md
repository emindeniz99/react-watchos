# Publishing `react-watchos` as an installable library

Status: **plan** (2026-06). Synthesizes two research spikes — native-target
distribution via Expo config plugins, and XCFramework-vs-source for the native
host. Goal: a developer adds a React-written watchOS app to their **existing
Expo app** with one install + one plugin line.

## Target developer experience

```bash
npx expo install react-watchos
```
```jsonc
// app.json
{ "plugins": [["react-watchos", { "name": "My Watch", "appGroup": "group.…", "widget": true }]] }
```
```tsx
// watch/index.tsx — the watch UI, in React
import { runApp, VStack, Text, useParams } from "react-watchos";
runApp(<App />);
```
```bash
npx expo prebuild -p ios   # plugin creates the watch (+ widget) target, links the native host, builds the JS
# open in Xcode, Run
```

From the consumer's side that is the whole flow — **plus a one-time signing
setup for real devices** (set their Apple Team in Xcode; approve App Group /
HealthKit capabilities on their account). That step is Apple's requirement and
cannot be automated by any plugin. Simulator needs no signing.

## Current state → gaps

The three real pieces of the library already exist and are tested:

- **JS reconciler** (`js/`) — components, hooks, `runApp`, widgets, intents, navigation.
- **Native host** (`swift/`) — `ReactWatchCore/Host/Runtime/Support` SwiftPM packages + a vendored **quickjs-ng** C engine (consumed as the Clang module `CQuickJS`).
- **Glue** (`app/plugins/*`, `app/scripts/*`, `app/targets/*`, `@bacons/apple-targets`) — but it is **demo-specific and hand-wired**.

What blocks "installable by a stranger":

1. **`swift/` is referenced by the relative path `../../swift`** (`wire-local-package.js`) — works only inside this monorepo. An external `npm i` consumer gets the JS but **no resolvable Swift package**.
2. **`js/package.json` `files` ships only `src`/`esbuild`/`README`** — no plugin, no Swift.
3. **The config plugin is not a package entry** (`app.plugin.js`); the logic is split across `app/plugins` + `app/scripts` + `app/targets`, wired to this one demo.
4. **Hardcoded identifiers** — App Group, target names, bundle IDs, deployment targets.

## Decision 1 — one npm package owns everything

`react-watchos` ships: the JS reconciler (source/bundle), the config
plugin (`app.plugin.js` → `plugin/`), the **thin per-target Swift glue**
(`WatchApp.swift`, `ReactWidgets.swift`, intents — the small files currently in
`app/targets/*`), and the **SwiftPM host** (the `swift/` package, which now
lives INSIDE the npm package at `js/swift`). The plugin resolves its own
install dir with `require.resolve('react-watchos/package.json')`, so the
old `../../swift` monorepo sibling assumption is gone.

## Decision 2 — native host: **source SPM now, XCFramework later**

The host is **compiled into the app binary** and **cannot be OTA-updated** (the
`applyUpdate` channel ships the *JS bundle* only). That makes "how does the
consumer get host fixes" the decisive axis.

**NOW (alpha): vendored Swift sources, distributed as a *remote* git/registry
SwiftPM dependency** (not `path:`/`workspace:*`). Source wins where it matters
for an alpha:

- **Debuggability** — step into the host (incl. QuickJS C), real stack traces, no dSYM management.
- **Fix delivery** — bump the package version + rebuild; no binary artifact pipeline on the critical path. A versioned source dep is the simplest correct delivery for an un-OTA-able host.
- **Cross-toolchain reliability** — recompiles against the consumer's Xcode/SDK, so no "binary built with Xcode 26 won't link under Xcode 16" failures.
- **Signing** — SwiftPM products compile into the target as object code; no nested `.framework` to embed + re-sign.
- **Avoids the QuickJS-in-XCFramework problem** entirely (below).

The one real gap to close for alpha: **publish the SwiftPM host to a remote
git/registry SPM URL** so `wireLocalPackage` references a *versioned* package
instead of a monorepo path. (Already named as remaining packaging polish in
`roadmap.md`.)

**LATER (stable): opt-in XCFramework, with source as the always-available
fallback** — mirroring React Native 0.81 / Expo SDK 54 (`ReactNativeDependencies.xcframework`
+ `RCT_USE_PREBUILT_RNCORE=0` to fall back to source). Buys ~10× faster clean
builds, but only worth it at scale, and gated on real prerequisites:

- A **green, signed macOS CI** building the host (also the standing gate for on-device trust).
- The **QuickJS-C-in-XCFramework** build: precompile to a static `.a` per slice + `include/` + a `module.modulemap` (named exactly that), wrapped via `xcodebuild -create-xcframework`.
- **Dual watchOS slices** — device `arm64` and simulator `arm64` cannot share a fat binary (this is what XCFramework exists to solve); decide on `arm64_32` for older hardware.
- **dSYMs** + a symbolication path; a source-build escape hatch for debugging.
- Keep **`ReactWatchCore`** (the codegen'd wire models) as *source* even then, so the wire contract co-versions with the JS at compile time instead of only at runtime.

**NEVER CocoaPods as the primary mechanism.** It integrates pods at the *main
app* target; our host lives in standalone watch-app + widget-extension targets
that are deliberately built without a Podfile. Reaching them via Pods is
*harder* than the SPM pbxproj-wiring we already have, and the ecosystem is
migrating to SwiftPM.

## Decision 3 — the config plugin

Both spikes agree hand-writing the local-SwiftPM pbxproj objects (our
`wireLocalPackage`) is still required — there is no stable SwiftPM-into-a-target
API yet (`@bacons/spm` and RN ≥0.84 `spm_dependency` are the future-clean path;
not stable mid-2026). Two phases:

**Phase 1 (alpha, least risk): unify the existing glue into one parameterized
plugin, still on `@bacons/apple-targets`.** Merge `with-react-watch-package.js`
+ `link-swift-package.cjs` + `merge-target-infoplist.cjs` + the two
`expo-target.config.js` into a single package-entry plugin with options;
publish the SwiftPM host remotely. This is the *minimum* to become "one
installable package," and keeps the proven apple-targets target-creation.

**Phase 2 (own the plugin): drop `@bacons/apple-targets`, create the targets
ourselves** (the OneSignal `onesignal-expo-plugin` pattern, which is how the
ecosystem ships app-extension/watch targets from one package):

- `withDangerousMod('ios')`: resolve our package dir via `require.resolve`, copy the thin per-target Swift glue + the esbuilt `bundle.js` into `ios/<Target>/`.
- `withXcodeProject`: idempotently (`pbxTargetByName`) `addTarget` (watch app / widget extension) + build phases + per-target settings + the host's **Embed Watch Content** copy phase, then run our existing `wireLocalPackage` **in order** (we now control ordering).
- Write Info.plist + entitlements **in code** (folding in `merge-target-infoplist.cjs`).
- Inject `extra.eas.build.experimental.ios.appExtensions` so EAS provisions/signs the extra targets.

This removes, in one move: the **Xcode-16 floor** (apple-targets' synchronized
folders), apple-targets' silently-dropped `infoPlist`, the **mod-ordering
hack**, and **both** post-prebuild scripts. **Tradeoff:** we re-own pbxproj
target creation across Xcode versions (the brittle part) — but we already
maintain the SPM-linking pbxproj code and have already hit every apple-targets
limit that forced the current workarounds.

### Plugin options (parameterize today's hardcoded values)

```ts
type Options = {
  name: string;                 // watch app display name
  appGroup: string;             // App Group id (defaults to bundleId-derived)
  widget?: boolean;             // create the widget extension (default true)
  healthKit?: boolean;          // HealthKit entitlement + read usage strings (default false — opt-in)
  workouts?: boolean;           // WKBackgroundModes ["workout-processing"] + HealthKit entitlement
                                //   + the workout save/route usage strings (default false — opt-in).
                                //   REQUIRED for startWorkout() and for
                                //   startHeartRate({ keepAliveInBackground: true }) to survive
                                //   backgrounding — Apple: a session needs the Workout processing
                                //   background mode. Composes with an extended-runtime mode.
  motion?: boolean;             // NSMotionUsageDescription (default false — opt-in). Needed by the
                                //   motion/gyroscope streams and by CMPedometer, which Apple
                                //   documents as CRASHING without the key (the bridge refuses
                                //   with UNAVAILABLE rather than calling). Previously emitted
                                //   under `healthKit`, which was wrong: CoreMotion is not HealthKit.
  push?: boolean;               // remote push: aps-environment entitlement (default false — opt-in)
  families?: WidgetFamily[];    // complication families
  deploymentTarget?: string;    // default "10.0"
  entry?: string;               // watch JS entry (default "watch/index")
  appleTeamId?: string;         // for EAS / signing scaffolding
  independent?: boolean;        // standalone watch app (default true); see below
};
```

**`independent` (default `true`).** Sets `WKRunsIndependentlyOfCompanionApp` on
the watch target, so the app installs and runs without the iPhone — the
framework's premise. Set it to `false` for a watch app that requires its iOS
companion (the key is then omitted; Apple treats absent as dependent).

> ⚠️ **Independence is irreversible after your first App Store upload.** Once a
> build with `WKRunsIndependentlyOfCompanionApp` is uploaded, you can't revert
> the app to companion-dependent. Decide `independent` **before** your first
> submission. (This is why the plugin gates the key behind an explicit option
> instead of always emitting it.)

## Versioning & the wire contract

The JS↔Swift wire schema (`js/codegen`) generates `WIRE_VERSION` into both
sides, and the runtime raises a loud error on a `tree.v` mismatch. Keep them
**co-versioned**: tag the SwiftPM host to the npm version, keep `ReactWatchCore`
as source so the contract is locked at compile time. OTA (`applyUpdate`) is only
valid *within* a wire version — add a guard so a mismatched bundle fails loud.

## npm packaging checklist

- [ ] Name (claim on npm; scope if taken, e.g. `@emin/react-watchos`).
- [ ] `exports` / `main` / `module` / `types` for the authoring API; `app.plugin.js` entry.
- [ ] `files`: dist + `plugin/` + the thin Swift glue + (Phase 1) the remote-SPM pointer.
- [ ] `peerDependencies`: `react`, `expo` (+ version ranges).
- [ ] README (the DX above) + LICENSE.
- [ ] A `react-watchos build` step that bundles the consumer's `watch/index.tsx` → the target's `assets/bundle.js`, wired into prebuild + a dev watch loop.

## Example / dogfood

`app/` → `example/`: install the library the **public** way
(`plugins: ["react-watchos", { … }]`), dropping the hand-wired
`plugins/` + `scripts/` + `targets/`. This proves the published install path
end-to-end (if our own example installs it like a stranger and it works, we know
shipping works), and stays as the docs demo + device-test ground. The folder
name is incidental; the substance is *consuming the public plugin*.

## CI

A **green, signed** macOS `expo prebuild` + `xcodebuild` for the watch is the
gate for (a) trusting the host on-device and (b) producing the XCFramework. JS
gates already exist (typecheck / lint / test / build + size budget).

## Phased roadmap

1. **Alpha** — publish the SwiftPM host remotely + a self-contained npm package + the unified (apple-targets-based) plugin + the dogfood example. *Reachable.*
2. **Own the plugin** — drop apple-targets, own target creation, delete both scripts, EAS appExtensions.
3. **Stable** — opt-in XCFramework (source fallback + dSYMs) behind the green signed CI; a `create-react-watchos` template; a docs site. (Aligns with the roadmap's "React → SwiftUI on any Apple platform" vision.)

## Open risks

- Config-plugin fragility across Expo SDK / Xcode versions — worst if we own target creation (Phase 2).
- **Signing/entitlements is the consumer wall** — unavoidable (Apple), the same one we hit deploying to the iP14p.
- Wire-contract drift if the host is ever shipped as a binary independent of the JS.
- Device-only validation — the simulator can't resolve AppIntents; real-watch testing across watchOS versions is an ongoing cost.

## Sources

- OneSignal config plugin (create-a-target + ship-native pattern): <https://github.com/OneSignal/onesignal-expo-plugin>
- `@bacons/apple-targets` + the SwiftPM PRs: <https://github.com/EvanBacon/expo-apple-targets> (PR [#122](https://github.com/EvanBacon/expo-apple-targets/pull/122), [#177](https://github.com/EvanBacon/expo-apple-targets/pull/177))
- Expo iOS app extensions + EAS `appExtensions`: <https://docs.expo.dev/build-reference/app-extensions/>
- Apple — distributing binary frameworks as Swift packages: <https://developer.apple.com/documentation/xcode/distributing-binary-frameworks-as-swift-packages>
- Precompiled React Native for iOS (0.81 / SDK 54): <https://expo.dev/blog/precompiled-react-native-for-ios>
- Creating an XCFramework around a static C library: <https://rhonabwy.com/2023/02/10/creating-an-xcframework/>
- QuickJS shipped as an XCFramework (precedent): <https://github.com/siuying/QuickJS-iOS>
