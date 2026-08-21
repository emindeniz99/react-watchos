# Migrations

Pre-1.0, **breaking changes ship as minor versions** (`0.x` semver:
`^0.1.0` never auto-upgrades you into `0.2.0`). The CHANGELOG says *what*
changed; this file says what a consumer *does* about it. Entries are newest
first, and only versions with consumer-facing action items appear.

<!-- Placement: repo root, next to README/CONTRIBUTING, and shipped nowhere —
     mirroring js/CHANGELOG.md, which is likewise absent from js/package.json
     `files` and (verified against a real `pnpm pack` tarball) from the npm
     package. Release reading happens on the repo; the tarball carries code. -->

## 0.5.x → 0.6.0

**Widget timeline views now render without the React reconciler.** The
element tree a `registerWidget` `render()` returns (each entry's `view`) —
and any direct `renderToTree` call — is walked ONCE by a plain static
renderer (`js/src/staticRender.ts`) instead of being mounted on a fiber.
What one-shot rendering always implied is now enforced: a widget component
is a **pure function of its props and the stores it reads**.

- **Effects never run.** `useEffect`/`useLayoutEffect`/`useInsertionEffect`
  are no-ops, and a class component contributes `render()` only — no
  `componentDidMount`, and no error-boundary catch (a throwing widget was
  already isolated per kind by the publish loop, and still is).
- **State never updates.** `useState`/`useReducer` hand back their initial
  value, and calling a setter *during* the render **throws**. Under the
  fiber a render-phase update re-rendered before commit; here there is no
  second render to produce, so it fails loud instead of serializing a tree
  the update never reached.
- **`Suspense`, `lazy()` and portals throw**, naming the offending type,
  rather than quietly rendering something a fiber render would not have.

Everything a static tree *can* honour still works, asserted node-for-node
against the fiber path (`js/test/staticRender.test.tsx`): function and class
components, `memo`, `forwardRef`, `Fragment`, arrays and keys, context
(`ThemeProvider`/`TranslationProvider` included), `useMemo`, `useCallback`,
`useRef`, `useSyncExternalStore`, `useId`, and the React Compiler's memo
cache. The wire shape is unchanged, and the same walker runs in the app's
`publishWidgets()` — so a violation surfaces at publish time in your own
runs (the kind is dropped from the payload with a logged
`render failed for "<kind>"`), not as a silently different tree on the
watch face. (Why: react-reconciler + scheduler were 83.8% of the widget
bundle — 153,362 B → 27,870 B minified once cut — and that much of the
extension's 16 MB JS heap on every timeline request.)

Action: read state during render; keep interaction an AppIntent
(`registerIntent` — function props still serialize to the literal `true` and
are never invoked widget-side); import widget components statically instead
of `lazy()`.

```tsx
// 0.5.x — legal under the fiber (a render-phase update re-renders):
// 0.6.0 — the setter throws.
function HydrationRing(_: WidgetRenderContext) {
  const [count, setCount] = useState<number>();
  if (count === undefined) setCount(hydrationStore.glasses);
  return <Gauge value={count ?? 0} min={0} max={8} label="Water" />;
}

// 0.6.0 — the render is the only pass, so the read belongs in it:
function HydrationRing(_: WidgetRenderContext) {
  return <Gauge value={hydrationStore.glasses} min={0} max={8} label="Water" />;
}
```

The effect-flavoured spelling of the same mistake —
`useEffect(() => setCount(hydrationStore.glasses), [])` — does **not** throw: the
effect never runs, so the widget renders the initial value. It rendered the
initial value on 0.5.x too (the tree was serialized straight after the first
commit, before any passive effect fired) — the walker turns that timing
accident into stated semantics.

The rest of 0.6.0 needs no action, all of it additive: every build now
writes a source map beside the bundle (`sourcemap: "external"` — no
`sourceMappingURL` comment is appended, so the shipped bytes and the OTA
`releaseId` hashed from exactly those bytes are unchanged; opt out with
`--no-sourcemap` / `{ sourcemap: false }`). Keep the `.map` OUT of your
target's assets — it is a build artifact for symbolicating a stack after the
fact; the watch never reads it. `keepNames`, the releaseId-keyed `symbols` store, and
the source-level debugger (`react-watchos dev --debug` +
`react-watchos debug`) are opt-in; `process.env.REACT_WATCH_DEV` is now
defined in every preset build (`"1"` dev / `""` shipping), so an entry can
fence dev-only wiring the way the demo fences the inspector.

## 0.4.x → 0.5.0

**The shipping build now minifies by default.** `buildBundles([…])` defaults
to `minify: true`, and `npx react-watchos build` does the same. Measured on
this repo's own bundles: the app went 605 KB → 195 KB (-68%) and the widget
~501 KB → ~150 KB (-70%); through the reference C host the minified bundle
also holds a 1.4 MB QuickJS heap instead of 2.1 MB and boots in 31.7 ms
instead of 44.1 ms. The dev path is unchanged and stays readable —
`watchBuildOptions` still defaults to `minify: false`, and `react-watchos dev`
pins it there explicitly.

It is not free: minification renames locals, and React's production frame
builder uses `fn.displayName || fn.name`, so your own components appear in
ErrorBoundary/inspector stacks as `at t` rather than `at ShoppingList`. Host
frames (`at VStack`, `at Text`) and the diagnostics ring are unaffected. Prop
names are never renamed (the wire protocol and the `__host` bridge are property
names — `mangleProps` is deliberately not used).

Action: none to keep the new default — unless your build script already passes
`minify` to `buildBundles` explicitly, in which case your value still wins and
nothing changes. `examples/expo-watch-app/scripts/build-targets.mjs` did exactly
that until this release (`--minify`/`MINIFY=1`, i.e. `false` with no flag set),
so anyone who copied it keeps shipping the same bytes; delete the option to take
the new default, or invert it to `--no-minify` the way both examples now do.

To opt out deliberately, pass `--no-minify` to the CLI or `{ minify: false }` to
`buildBundles`; `--minify` still parses, and `--no-minify` wins if both are
given. If you assert on your bundle's TEXT in a test (e.g. that a string
appears in the output), that assertion now reads a minified bundle — build
that fixture with the opt-out.

The HealthKit widening that shipped alongside needs no code change:
`requestHealthAuthorization({ read: [...] })` names what you request, so the
authorization sheet grows only when you ask for the new types. One default
did move: the config plugin's fallback `NSHealthShareUsageDescription` was
reworded to name what `health.ts` can now read — the old string never
mentioned blood oxygen while the sheet showed that row for any app reading
`oxygenSaturation`. The plugin only fills the key when you set none, so the
next `expo prebuild` picks the new string up; if you supply your own, make
sure it names every category you actually read — a sheet requesting a type
its purpose string never mentions is what App Review reads as a lie.

## 0.3.x → 0.4.0

**Duplicate native-event subscriptions now fire once each, not once total.**
`registerNativeListener` (and everything built on it — `onBleState`,
`onPhoneMessage`, sensor streams) used to store handlers in a
`Set<NativeEventHandler>`, which dedupes by function identity: subscribing
the SAME function twice collapsed to one entry, and the first unsubscribe
deleted it, silencing the subscription that was still live. Each
subscription now carries its own identity, so it also delivers its own
call.

Action: only if you deliberately subscribe one function reference more
than once and rely on the old collapse — you will now see the side effect
twice (two haptics, two state updates). Either subscribe distinct
functions, or unsubscribe in cleanup so a re-render cannot stack
subscriptions. Nothing to do if your effects already return their
unsubscribe.

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
3. **Navigation is route-based, confirmed — and lazy** (ARCH-09):
   `NavigationLink` takes `to` + `label`/`children` as ROW content;
   destinations live in `NavigationRoute`s; wrap the app in
   `NavigationProvider` (+ `scheme`) and control the stack with
   `useNavigation`'s `path`/`setPath`. A link press is confirmed by the
   native stack — in tests, navigate with `pushDeepLink("scheme://route")`.
   Lazy is the part that bites code that used to eager-mount: only the root
   and the screens on the active path are mounted, so a bare
   `useEffect(..., [])` in a screen runs at first open (not at launch), and
   **screen-local state drops when the screen is popped** — lift state that
   must survive a pop into a store or a context above the stack. Covered
   screens stay mounted while a deeper screen is on top, so focus-scoped
   side effects (BLE, sensors, polling) belong in `useFocusEffect`, which
   cleans up on blur where a plain effect keeps running.
4. **Phone-pushed state arrives on its own channels** (ARCH-12):
   WatchConnectivity inbound is split by delivery semantics, and
   phone-pushed application context / user info **no longer arrive on
   `onPhoneMessage`**.

   ```ts
   // workspace era: one merged inbound stream
   onPhoneMessage((payload) => applySettings(payload));
   // 0.1.x: subscribe the channel matching how the phone sent it
   onApplicationContext(applySettings); // updateApplicationContext: latest-wins state
   onUserInfo(recordEvent);             // transferUserInfo: FIFO, survives suspension
   onPhoneMessage(handleMessage);       // sendMessage: interactive, phone reachable now
   ```

   The outbound mirrors (`updateApplicationContext`, `transferUserInfo`)
   arrived in the same split, additively.
5. **One root at a time** (ARCH-08): `runApp` throws if a root is mounted.
   Tests use `mountApp` + `afterEach(resetApp)` from `react-watchos/testing`.
6. **Testing imports**: `findByType`/`findByText` moved to
   `react-watchos/testing` long ago; the new harness lives there too.
