# Migrations

Pre-1.0, **breaking changes ship as minor versions** (`0.x` semver:
`^0.1.0` never auto-upgrades you into `0.2.0`). The CHANGELOG says *what*
changed; this file says what a consumer *does* about it. Entries are newest
first, and only versions with consumer-facing action items appear.

## 0.2.x → 0.3.0

No action required unless you set `TabView`'s brand-new `style` prop
between 2026-08-10 and this release: `"carousel"` was renamed `"page"`.
The old name promised a SwiftUI style the renderer never applied
(`.carousel` is deprecated in SwiftUI, and the value mapped to "no
modifier"), so it now names what it does. Omitting `style` is unchanged
and still means "SwiftUI's own default pager".

### Why there is no codemod

Migrations here are one-line prop edits a search-and-replace handles, and
the whole consumer base fits in a room. A `next/expo`-style codemod CLI
earns its maintenance only when a breaking change is mechanical AND wide —
so the trigger is written down instead of the tool: ship a jscodeshift
codemod for the FIRST migration that rewrites more than a handful of call
sites in a consumer we do not own. Until then, this file is the migration
tool.

## 0.1.x → 0.2.0

No action required — 0.2.0 is additive for anyone who started on the
published 0.1.0 (new `react-watchos/testing` harness, WorkoutKit spike
verification, engine bump to quickjs-ng 0.16.1, packaging fixes).

New, worth adopting in tests:

```ts
import { installInvokeHost, mountApp, pushDeepLink, resetApp } from "react-watchos/testing";

afterEach(resetApp);            // disposes roots — no more "a root is already mounted"
const { calls } = installInvokeHost({ requestNotificationPermission: "granted" });
mountApp(<App />, new MemoryHost());
pushDeepLink("myapp://settings"); // link presses are native-confirmed; this is how tests navigate
```

## Workspace-era code (pre-0.1.0 forks) → 0.1.x

For apps that consumed the renderer as `react-native-watchos` from a
monorepo workspace before the first npm release. The worked example is the
`ctrl-a-remote` migration (playground commit `63e331e3`).

1. **Identity**: dependency and imports rename `react-native-watchos` →
   `react-watchos`; install from the registry (`"react-watchos": "^0.1.0"`),
   drop the `../react-native-watchos/js` workspace member.
2. **BLE (and every fallible API) rides the invoke channel** (CX-022):
   `bleConnect`/`bleWrite`/`bleSubscribe` return promises settled by native.
   There is no `__host.ble` channel any more. If your app treats
   `onBleState` as the state authority (it should), `void ...().catch(() => {})`
   on the call promises is legitimate; tests mock the wire with
   `installInvokeHost()` instead of a hand-rolled `__host`.
3. **Navigation is route-based and confirmed** (ARCH-09): `NavigationLink`
   takes `to` + `label`/`children` as ROW content; destinations live in
   `NavigationRoute`s; wrap the app in `NavigationProvider` (+ `scheme`) and
   control the stack with `useNavigation`'s `path`/`setPath`. A link press is
   confirmed by the native stack — in tests, navigate with
   `pushDeepLink("scheme://route")`.
4. **One root at a time** (ARCH-08): `runApp` throws if a root is mounted.
   Tests use `mountApp` + `afterEach(resetApp)` from `react-watchos/testing`.
5. **Testing imports**: `findByType`/`findByText` moved to
   `react-watchos/testing` long ago; the new harness lives there too.
