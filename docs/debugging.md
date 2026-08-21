# Debugging a React app running on a watch

The honest version of "what happens when it breaks, and how do I read it."
There is no React DevTools here and no breakpoint debugger — see
[What this is NOT](#what-this-is-not) for why. What there *is* is five
surfaces, each of which tells you a different thing, a local repro loop that
runs the real engine on your laptop, and a source map that turns a minified
`at t` back into your component
([Symbolicating a minified stack](#symbolicating-a-minified-stack)).

Every mechanism below is in the shipped code; the file references are the
proof.

## The five surfaces, and when each one is the right one

| Surface | Where you see it | Available in | Use it for |
|---|---|---|---|
| **Full-screen error text** | On the watch, instead of your UI | always | boot failures — the bundle never rendered |
| **Error banner** | On the watch, bottom overlay, tap to dismiss | always | a recoverable failure *after* something rendered |
| **Diagnostics ring** | `onDiagnostic(...)` in JS; the native ring holds the last 50 | always, release builds too | structured, machine-readable failures with a session/release id |
| **Console.app / Xcode console** | Mac, streamed from the watch | always | `console.log`, cold-start timings, widget-extension logs |
| **Remote inspector** | A browser page on your Mac | DEBUG (opt-in call) | the live committed tree + log/error history |

## What a crash on-wrist actually looks like

### 1. A component throws during render, inside an `ErrorBoundary`

You see your `fallback`, not a red screen. `ErrorBoundary`
([`js/src/errorBoundary.tsx`](../js/src/errorBoundary.tsx)) hands both the
error and React's `ErrorInfo` to `onError` *and* to a function `fallback`,
so the **`componentStack` — which subtree threw — is available on-device**:

```tsx
<ErrorBoundary
  onError={captureError}                       // feeds the inspector's error panel
  fallback={(error, info) => (
    <ScrollView>
      <Text size={12} color="red">{error.message}</Text>
      <Text size={10}>{info?.componentStack ?? ""}</Text>
    </ScrollView>
  )}
>
  <HydrationScreen />
</ErrorBoundary>
```

`info` is `null` on the first fallback render and populated on the re-render
that follows `componentDidCatch` — render both states, or you will read a
blank stack once and think it is missing.

**Boundaries do not catch event-handler errors.** A throw inside `onPress`
is not a render error; it surfaces through the host's banner (next section)
instead.

### 2. Anything else throws — the banner

Uncaught errors do not get swallowed. `WatchRoot` rethrows React's
`onUncaughtError` ([`js/src/renderer.ts`](../js/src/renderer.ts)) so a broken
UI fails loudly, and the native side turns every JS-side failure into a
**recoverable `js` diagnostic**, which draws the bottom banner: red, monospaced,
scrollable, capped at 120 pt, dismissed by tapping it
([`ReactWatchHost.swift`](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift)
— the `.overlay(alignment: .bottom)` on the root view).

The diagnostic's `code` names **where** the engine was when it blew up:

| Code | What it means |
|---|---|
| `js.eval` | the bundle threw while being evaluated (module scope, or the first render) |
| `js.call` | a call *into* JS threw — an event dispatch, a timer fire, a widget render |
| `js.job` | a microtask/job threw (an `async` function with no `catch`) |
| `js.promiseRejection` | a promise rejected with nobody listening — a failed `fetch`, an unawaited invoke |
| `js.shutdown` | something called into the runtime after it was disposed |

`js.promiseRejection` is the one people miss: a bare rejection never throws at
the job level, so the runtime installs a rejection tracker specifically to make
it visible (`JS_SetHostPromiseRejectionTracker`,
[`JSRuntime.swift`](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift)).
Without it, a rejected `fetch` in an effect is silence.

### 3. The bundle never booted — the full-screen path

If nothing has rendered yet, the latest **fatal** diagnostic takes the whole
screen as red footnote text in a `ScrollView` (so a long message is readable
by scrolling on-wrist). That is the boot-failure shape: a syntax error in the
bundle, a wire-version mismatch, a refused OTA. A separate "update required"
screen appears when the hard update gate refuses to run a stale bundle.

Practical tell: **red text filling the screen = it never ran; a red bar at the
bottom = it ran and then something failed.**

## Reading a diagnostic

Every host-side error or notice is a structured `Diagnostic`
([`js/src/diagnostics.ts`](../js/src/diagnostics.ts), mirrored by
`ReactWatchSupport`'s Swift record). The native ring keeps the **last 50, in
release builds too** — this is not a DEBUG-only facility.

```ts
import { onDiagnostic } from "react-watchos";

useEffect(() => onDiagnostic((d) => {
  // d.code       "ota.saveRejected" — stable, dot-namespaced by subsystem
  // d.severity   "fatal" | "recoverable" | "info"
  // d.subsystem  boot | ota | wire | commit | js | capability | budget |
  //              connectivity | widgets
  // d.sessionId  fresh UUID per native boot — correlates one JS generation
  // d.releaseId  content hash of the booted bundle (absent before load)
  // d.target     "watch" | "widget"
  // d.timestamp  epoch ms
  // d.details    human-readable message
  telemetry.send(d);
}), []);
```

Two fields do the forensic work:

- **`sessionId`** groups records from one native boot. After an OTA rollback
  you get two sessions in one debugging story; the ids keep them apart.
- **`releaseId`** says *which bundle* produced the record. A poisoned OTA
  bundle's own async errors are deliberately stamped with the **dead bundle's**
  release id rather than the shipped one that replaced it — those records are
  the rollback forensics.

One deliberate asymmetry, so you are not confused by it: `js`-subsystem
records are recorded and bannered but **not** pushed back into JS. A listener
that throws would otherwise feed the next error — an echo loop.

## Console.app and the Xcode console

`console.log` in JS goes over `__host.log` into an
[`os.Logger`](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift) — not
`print` — on any platform that has `os` (the Linux/test builds fall back to
`print`). Two streams, one subsystem:

| Subsystem | Category | Carries |
|---|---|---|
| `com.reactwatchos.runtime` | `js` | everything your `console.*` writes |
| `com.reactwatchos.runtime` | `boot` | cold-start timings |

Open **Console.app**, select the watch (or the paired iPhone's watch device),
and filter on the subsystem. From a terminal the same stream is
`log stream --predicate 'subsystem == "com.reactwatchos.runtime"'`.

The `boot` line splits the two phases that scale with different things:

```
boot bundle.js (184681 B): parse 12.0 ms + eval 19.3 ms = 31.3 ms total
```

Parse scales with source **size**, eval with your tree and logic — so when a
cold start gets slower, the split tells you which budget you actually spent.
**The simulator runs at Mac speed**: only a real watch gives you the true
single-threaded number.

## The remote inspector (live tree, logs, errors)

A DEBUG build can stream its state to a browser on your Mac. Two halves:

```sh
npx react-watchos inspector          # or, in this repo: pnpm --filter react-watchos inspector
```

```ts
import { startInspector } from "react-watchos";
startInspector({ url: "http://127.0.0.1:8099/snapshot" });
```

Open <http://127.0.0.1:8099>. The page has three columns — **TREE** (the live
committed tree as JSON, with a commit counter), **LOGS** (a `console.log` tee,
last 200), **ERRORS** (last 50, each with its stack and `componentStack` when
one was captured). The watch simulator shares the Mac's network, so
`127.0.0.1` works; for a physical watch, bind the server to the LAN and use
your Mac's Wi-Fi IP.

Wiring the error panel is one prop:
`<ErrorBoundary onError={captureError}>`. `console.error` also feeds it — a
lone `Error` argument keeps its stack.

Two guards worth knowing, because they change what you observe
([`js/src/inspector.ts`](../js/src/inspector.ts)):

- An **unchanged snapshot is not posted**. An idle app shows a frozen
  timestamp; that is the battery guard doing its job, not a hang.
- After **30 consecutive failed posts** the inspector stops itself — the
  backstop for a `startInspector()` call that ships in a release bundle by
  accident. If your viewer goes quiet after ~30 s, the server was never
  reachable.

Host diagnostics are buffered into the snapshot too (last 50) and are served
in the JSON at `/snapshot`; the built-in viewer page renders tree, logs and
errors only — read the raw JSON for the diagnostics ring, or forward it with
`onDiagnostic`.

## The local repro loop (no watch required)

Most "on-wrist" failures are engine or contract failures, and those reproduce
on Linux/macOS in seconds. Reach for these **before** rebuilding for hardware:

- **`pnpm --filter react-watchos test`** — the vitest suite, including
  `qjs-smoke.test.ts`, which runs the *real production bundle* inside a real
  QuickJS interpreter against a JS mock of the `__host` global that mirrors
  what `JSRuntime.swift` installs. If a bundle passes here, the same bundle
  runs in quickjs-ng on the watch — because it is the same engine: the harness
  builds `tools/vendored-qjs` from `js/swift/Sources/CQuickJS`, the sources
  SwiftPM compiles for the watch. (Needs a C compiler, nothing else. Do **not**
  install a distro `qjs`: that is Bellard's QuickJS, a different engine that
  reports stack frames without line or column, and it is what made source maps
  look impossible here.) The same run includes `qbc-symbolication.test.ts`,
  which takes a throwing `.tsx` all the way to production bytecode and back to
  the source line — that is the one that tells you whether a stack from the
  field will be readable at all.
- **`tools/embed-smoke/run.sh`** — compiles the *vendored* quickjs-ng sources
  with a reference C host and runs the bundle through the exact embedding
  sequence Swift uses, then gates on engine heap and boot time. This is the
  one that catches "works in `qjs`, breaks in our embedding."
- **`runApp(element, new MemoryHost())`** plus `findByType` / `findByText`
  from `react-watchos/testing` — assert on the committed tree directly. Note
  the serialization quirks ([docs/updates.md](./updates.md)): `<Text>` content
  folds into `props.text`, and function props serialize to the literal `true`.
- **`pnpm --filter react-watchos dev`** — DEBUG builds poll the dev server
  every 2 s and hot-restart the QuickJS runtime when the bundle changes, so
  the edit→see-it loop needs no Xcode rebuild. Release builds compile the
  polling out (`#if DEBUG`).

For the simulator specifically, use
[`docs/running-on-sim.md`](./running-on-sim.md) — it documents the App-Group
signing trap that makes shared state silently read `0` and look like a
renderer bug.

## Symbolicating a minified stack

The build writes `<outfile>.map` next to every bundle **by default**, and
writes it as esbuild's `"external"`: no `sourceMappingURL` comment is appended,
so not one shipped byte moves and the OTA `releaseId` (an FNV-1a over exactly
those bytes) is identical with the map on or off. The watch never reads it; it
is a build artifact you keep so a stack from the field is still readable.
`--no-sourcemap` (CLI) / `{ sourcemap: false }` (`buildBundles`) opts out.

It is worth keeping because the engine we ship reports enough to use it.
Measured on the vendored quickjs-ng, a minified frame reads

```
    at n (bundle.js:1:30)
```

— line **and column**, which is exactly what a source map is indexed by. Feed
a stack in on stdin:

```bash
pnpm --filter react-watchos symbolicate dist/bundle.js.map < stack.txt
# at k (real.tsx:2:13)   [was k @ real.js:1:4792]
```

Frames it cannot resolve are printed through unchanged rather than dropped.
The script ([`js/scripts/symbolicate.ts`](../js/scripts/symbolicate.ts)) is a
thin CLI over [`symbolicate-core.ts`](../js/scripts/symbolicate-core.ts) —
`parseStackFrame` + `symbolicateFrame`, ~40 lines over
`@jridgewell/trace-mapping`, the same mapping library the JS toolchain (Rollup,
Vite, Sentry's tooling) resolves maps with. There is no watch-specific magic to
it, so a hosted crash reporter fed the same `.map` resolves the same frames,
and your own telemetry pipeline can `import { symbolicateFrame }` instead of
re-deriving the 1-based/0-based column dance. (Engines report columns 1-based,
source maps are 0-based; the core does that conversion in exactly one place,
which is why it is a module and not two copies.)

Keep the map with the build that produced it. A map only matches the exact
bytes it was emitted for — symbolicating one release's stack against another
release's map yields confident nonsense.

### This works on the bytecode the watch actually runs

A release watch app does not boot `bundle.js`. It boots `bundle.qbc`, the
precompiled QuickJS bytecode
(`JSRuntime.evaluateBytecode` → `JS_ReadObject` + `JS_EvalFunction`), and for a
while that path reported **nothing**: `tools/qjs-compile` wrote the blob with
`JS_WRITE_OBJ_STRIP_DEBUG`, which drops the per-opcode line/column tables, so
every production frame came back as

```
    at Dp (<null>:0:1)
```

— no filename, no line, no column, and therefore a source map with nothing to
resolve. The maps were being emitted faithfully and were inert on the only path
that shipped.

That flag is gone. **Shipped `.qbc` frames now carry generated positions and
symbolicate exactly like source-parsed ones** — byte-identical output, same
`bundle.js:line:column` shape, same command above, no bytecode-specific step.
The debug tables cost **+45 KB** on the minified app bundle's blob
(204,979 → 250,361 B; they scale with opcode count, not source size), +36 KB
of QuickJS heap and +0.07 ms in `JS_ReadObject` (1.23 → 1.31 ms, median of 21
runs in the vendored engine), with eval unchanged — paid so a crash from the
field is readable.

[`js/test/qbc-symbolication.test.ts`](../js/test/qbc-symbolication.test.ts) is
the guard, and it is deliberately end-to-end: a `.tsx` that throws, built
through the real preset, compiled by the real `qjs-compile`, executed as
bytecode in the real vendored quickjs-ng, and the resulting `Error.stack`
resolved back to that `.tsx`'s line and column **through the same
`symbolicate-core.ts` the CLI uses**. Its first assertion is that the stack
contains no `<null>` — the regression signature of `STRIP_DEBUG` returning.

What is still stripped is the **source text** (`JS_WRITE_OBJ_STRIP_SOURCE`
stays on): keeping it roughly quadruples the blob — 250 KB → 903 KB on the app
bundle — and buys nothing for stacks, because positions come from the debug
tables, not from the embedded text. The one visible consequence is that
`Function.prototype.toString` on a function from a shipped bundle returns no
source on-device. Nothing in the runtime reads it; if your code does, it will
not work from `.qbc`.

## What this is NOT

Stated plainly, because the gap is real:

- **No React DevTools.** The DevTools backend needs a **WebSocket transport,
  and QuickJS has none** — there is no `WebSocket` in the engine and no
  platform one to borrow (watchOS ships no public JavaScriptCore and no
  WebKit). The inspector above is the deliberate substitute: `fetch`-based
  polling, which is the transport we *do* have. No component inspector, no
  props editing, no profiler flamegraph.
- **No breakpoints or stepping.** There is no debugger protocol wired to the
  embedded engine. Debugging is `console.log`, the diagnostics ring, and the
  tree snapshot.
- **No Safari Web Inspector.** That attaches to JavaScriptCore/WebKit, neither
  of which exists on watchOS.
- **The shipped bundle is minified, so a raw frame reads `at t`.** Since
  2026-08-20 the shipping path minifies by default (`react-watchos build`,
  `buildBundles`), which renames locals; React's production frame builder uses
  `fn.displayName || fn.name`, so YOUR components come out as `at t` instead of
  `at ShoppingList`. Host frames (`at VStack`, `at Text`) are string literals in
  the renderer and stay readable, as does the diagnostics ring. This one is
  **recoverable after the fact** — the build writes a source map beside the
  bundle by default, and that holds for the `.qbc` bytecode a release app
  actually boots, not just for `bundle.js`; see
  [Symbolicating a minified stack](#symbolicating-a-minified-stack).
- **No source text on-device.** The shipped `.qbc` is written with
  `JS_WRITE_OBJ_STRIP_SOURCE`, so `Function.prototype.toString` on anything
  from the bundle gives you no source back. Stack *positions* are there (the
  debug tables are kept on purpose); the *text* is not, and buying it back
  would roughly quadruple the blob for no gain in a stack.
- **A DEBUG launch is not automatically running a readable bundle.** Two cases
  bite. (1) `ReactWatchModel.start()`
  ([`ReactWatchHost.swift:312`](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L312))
  calls `boot()` — which loads the applied OTA bundle if there is one, else the
  **shipped asset bundle** (`load()` → `otaSequencer.boot` → `loadShipped`) —
  *before* the `#if DEBUG startDevReload()` on line 446, and `pollDevServer()`
  deliberately does not reboot on its first fetch. So a DEBUG watch app runs
  that bundle (minified, if that is how you built it) until your first source
  edit, and **a crash at boot is a crash in THAT bundle**, not in the
  dev-server one.
  (2) Widget bundles are never dev-served at all — there is no polling loop in
  the widget host — so a widget always runs its asset bundle. When you are
  chasing either, rebuild the asset with `--no-minify` (CLI) or
  `{ minify: false }` (`buildBundles`) and re-run; `react-watchos dev` itself
  already builds its live-reload bundle unminified. (`--keep-names` is the
  middle option: still minified, still ~the shipped shape, names intact for
  +17 KB.)
- **A device DEBUG build bakes in the LAN packager host at port 8081**, and
  nothing checks WHOSE packager answers. Run a second project's Metro on 8081
  and the watch/phone silently loads that project's bundle — you get someone
  else's app, or a cryptic module error, with no hint that the bundle came
  from the wrong server. Seen on a real device, 2026-08-11 (adagia session).
  Give each project its own port (`expo start --port 8082`) and check
  `lsof -ti :8081` before blaming your bundle.
- **The error banner is developer-facing, not a user-facing error UI.** It is
  a red bar with a monospaced message. Ship your own `ErrorBoundary` fallback
  for anything a user should see.

## See also

- [status.md](./status.md) — what is actually verified, per capability.
- [performance-measurement.md](./performance-measurement.md) — the other half
  of the story: `os_signpost`, Instruments on a real watch, and what we can
  and cannot claim.
- [budgets-and-limits.md](./budgets-and-limits.md) — every budget whose breach
  shows up as a `budget` diagnostic.
- [updates.md](./updates.md) — the commit model and the serialization quirks
  that trip up tree assertions.
