# Design: real breakpoints for watch JS, without JavaScriptCore

**Status:** spike, prototype landed and gated. 2026-08-21.

The roadmap declined JavaScriptCore on watchOS and named the prize it was
giving up: *real breakpoints*. It also named the cheaper path — "a DEBUG-only
DAP adapter … driving quickjs-ng's interrupt/debug hooks over a socket Swift
owns." This document is the result of actually trying that, and it reports one
finding that changes the shape: **quickjs-ng has no interrupt/debug hooks to
drive.** So the breakpoint does not live in the engine at all. It lives in the
code.

What now exists and is gated by tests:

- a DEBUG-only build transform that puts a `__dbg(fileId, line)` probe at every
  statement boundary and a shadow frame around every function body;
- a runtime probe module that keeps the breakpoint set, the stepping mode and
  the shadow stack, and **parks the JS thread** in a blocking exchange when it
  stops;
- a minimal DAP adapter on the dev server, so VS Code attaches to a TCP port
  and drives it;
- the one piece of native code the design needs: a synchronous
  `__debugPoll(json) -> json` host hook, `#if DEBUG`, off the generated bridge.

Measured cost on the demo app bundle: **+5.2 % bytes, +4.5 % boot, +1.1 % per
interaction** — with the renderer deliberately left uninstrumented, which is
where the number comes from (§6).

---

## 1. The constraints, and which one decides the design

| # | Constraint | Consequence |
|---|---|---|
| C1 | The vendored quickjs-ng sources must not be forked or patched. A bot proposes upstream bumps and refreshes `js/swift/Sources/CQuickJS` file-by-file; a patched engine makes every bump a merge. | **Decides the design.** See §2. |
| C2 | DEBUG only. Nothing may ship in a release bundle. | The `REACT_WATCH_DEV` define pattern, plus a stronger version of it (§5.4). |
| C3 | Prefer the existing transports: the dev server and the DEBUG app's HTTP polling loops. | Taken for the *dev-server* side; **refuted** for the paused side (§4). |

C1 is the one that decides everything. The other two shape it.

## 2. Prior art, and what each one settles

Surveyed before designing, per the repo rule.

### koush/quickjs + vscode-quickjs-debug — the reference implementation, and why we refuse it

[koush/quickjs](https://github.com/koush/quickjs) is *"QuickJS Fork with VSCode
debugging support"*. The debugger lives inside `quickjs.c`: it generates **two
opcode dispatch tables** and switches to the debugging one when a debugger is
active, with `js_debugger_check_breakpoint`, `js_debugger_build_backtrace`,
`js_debugger_current_location` and friends hooked into the interpreter loop.
Its [protocol](https://github.com/koush/vscode-quickjs-debug/blob/master/protocol.md)
is DAP messages forwarded almost verbatim over a hex-length-prefixed TCP
stream, with the extension acting as a transparent proxy.

**What we borrow:** the verb set and the proxy topology. Its adapter is
*"transparent"* — VS Code's DAP goes almost unchanged to the engine — and that
is the shape §5.3 copies, with the dev server standing where its extension
stands.

**What we refuse:** the fork. This is C1, and it is not a stylistic objection.
The [quickjs-ng discussion on adding a debugger](https://github.com/quickjs-ng/quickjs/discussions/757)
is still open in 2026: a port of koush's code was attempted in April 2025 and
stalled on breakpoints and line-number calculation, and the maintainers asked
for it behind a compile-time feature flag over concerns about duplicating the
dispatch table. Adopting a patch upstream has not merged, into an engine we
re-vendor on a bot's schedule, is a standing merge conflict on the most
security-sensitive file in the repo.

I checked the vendored header directly rather than trusting the discussion.
`js/swift/Sources/CQuickJS/include/quickjs.h` (quickjs-ng v0.16.1) exposes
exactly one hook near this problem:

```c
typedef int JSInterruptHandler(JSRuntime *rt, void *opaque);
JS_EXTERN void JS_SetInterruptHandler(JSRuntime *rt, JSInterruptHandler *cb, void *opaque);
```

That is a watchdog, not a debugger. It is called every N opcodes, it receives
**no source position and no frame**, and its only answer is "abort or
continue". You cannot build "stop on line 42" out of it, and you cannot ask it
what the stack is. There is no `JS_GetStackFrame`, no scope enumeration, no
breakpoint API. The roadmap's phrase "quickjs-ng's interrupt/debug hooks" was
half right: the interrupt hook exists, the debug hooks do not.

**So the engine is out, and the only remaining place to put a breakpoint is the
source.**

### babel-plugin-istanbul — the mechanics of statement instrumentation

Coverage tooling has been putting a counter at every statement boundary for a
decade; `babel-plugin-istanbul` is the reference. What it settles: the boundary
set (statements in `Program.body`, `BlockStatement.body`, `SwitchCase.consequent`),
that Babel is the right tool for finding them in TSX, and — from its
[own issue tracker](https://github.com/istanbuljs/babel-plugin-istanbul/issues/139)
— that the instrumentation is heavy enough that "use for testing only, never
for production code" is the documented rule. §5.4 is that rule turned into a
test.

We differ in what we insert. Istanbul increments a counter and never reads it
until the process ends; we call a function that may **not return for minutes**,
and we also need frames, which coverage does not.

### Hermes / Metro / React Native DevTools — the road not available

Hermes implements the Chrome DevTools Protocol *inside the VM* (`Debugger.*`),
and Chrome connects to the device through Metro, which proxies the single CDP
connection. React Native 0.76 shipped an all-new CDP backend on the same model.

This is the "right" architecture and it is unavailable to us for exactly the C1
reason: it presumes you own the engine. What we take from it is the *topology* —
the bundler's dev server is the rendezvous point, so the editor talks to
something on the developer's machine and never to the device directly. Our
watch dials out to the dev server for the same reason Hermes dials out to
Metro: nothing on the host can reliably open a connection to a watch.

The protocol choice follows from the same reasoning inverted. CDP is what an
engine exposes; DAP is what an editor consumes. With no engine support to
expose, implementing the *editor's* protocol is strictly less work and gets a
UI for free through VS Code's `debugServer` attach.

### DAP itself

The [specification](https://microsoft.github.io/debug-adapter-protocol/specification.html)
and [overview](https://microsoft.github.io/debug-adapter-protocol/overview)
give the base protocol (`Content-Length: N\r\n\r\n` + a UTF-8 JSON body), the
`initialize` → `initialized` → configuration → `configurationDone` handshake,
and the minimal verb set. Two details from the spec shaped the implementation:

- `setBreakpoints` is **non-incremental** — "clear all previous breakpoints for
  the source and then set the ones specified". Our watch-facing command carries
  the *whole* set for that reason, so a dropped exchange cannot strand a stale
  breakpoint (§5.1).
- the response must report the **actual** breakpoints, because "the generic
  debugger updates the UI dynamically if a breakpoint could not be set at the
  requested position or was moved". Instrumentation makes this common — you can
  only stop on a line that has a probe — so the adapter snaps a requested line
  down to the next instrumented one and says so (§5.3).

---

## 3. The architecture

```
   VS Code                    node (react-watchos debug)                 watch (DEBUG)
 ┌──────────┐  DAP over TCP  ┌──────────────────────────┐  HTTP POST   ┌────────────────┐
 │  editor  │◄──────────────►│  DapSession              │◄────────────►│ __debugPoll    │
 │          │  Content-Length│  · breakpoints by fileId │  /debug/poll │  (sync, blocks)│
 └──────────┘                │  · pending resume verb   │  long-polled │       ▲        │
                             │  · last reported frames  │              │       │        │
                             └───────────┬──────────────┘              │  __dbg(f,l)    │
                                         │ reads                       │  probes in     │
                                  <outfile>.dbg.json                   │  every stmt    │
                                  (path ↔ fileId, probe lines)         └────────────────┘
                                         ▲
                                         │ written by
                             esbuild + Babel debug transform
```

Three properties are worth stating because they are what the design buys:

1. **The watch is the client on both channels.** It dials the dev server for
   bundles today and for debug commands now. Nothing has to reach *into* a
   watch.
2. **Frames are already in original source coordinates.** The probe was placed
   by something that could still see the `.ts`, so a stack frame is
   `add:13`, not `bundle.js:1:30474` needing a source map. This is
   instrumentation's real payoff over an engine debugger and it is why
   `stackTrace` needs no `@jridgewell/trace-mapping` round trip.
3. **The pause is a blocking loop, not a state machine.** The JS thread stays
   inside the frame it stopped in, so "resume" is just returning from a
   function. Nothing has to be snapshotted or restored.

## 4. The finding that changed the plan: `fetch` cannot be the transport

The proposed architecture said the watch needs **no new native code**, because
the paused loop could poll the dev server with the existing `fetch` shim. It
cannot, and the reason is structural rather than a matter of effort.

- The app runtime's owning queue is `DispatchQueue.main`
  (`JSRuntime.swift`: `resolvedQueue` is `.main` for the watch target; only the
  widget gets its own queue).
- `fetch` is asynchronous by construction: `__host.fetch(id, json)` arms a
  URLSession request, and Swift settles it by **calling back into JS** —
  `__resolveFetch(id, …)` — which routes through `onOwningQueue`, i.e. main.
- A paused debugger holds the JS thread by definition. So a JS loop spinning on
  main waiting for `__resolveFetch` is waiting for a hop onto the queue it is
  occupying.

That is a deadlock, not a slow poll. The app would freeze at the first
breakpoint and never come back.

Two escapes were considered and rejected before the third was taken:

- **Don't block — unwind and resume later.** A generator/CPS transform can
  suspend a JS frame without holding the thread. It is also a rewrite of every
  function in the bundle, it breaks React's synchronous render path (the
  reconciler calls components synchronously and cannot await), and it is an
  order of magnitude more transform than this whole spike. Rejected on cost and
  on blast radius.
- **Reuse a synchronous host method that already exists.** `__host.getItem` is
  synchronous and returns a string, so a background Swift task could write
  dev-server commands into App-Group storage and the blocked JS thread could
  read them. It works on paper, and it is worse: it needs *new Swift anyway*
  (nothing polls for commands today), it repurposes app storage as a debug
  channel, and it hides a debugger inside a shipping capability. Rejected.

**Taken instead: one synchronous host hook, `#if DEBUG`, off the generated
bridge.**

```swift
// JSRuntime.swift, #if DEBUG
public func installDebugPoll(_ handler: @escaping (String) -> String)
// installs globalThis.__debugPoll(stateJson) -> commandJson
```

Why this is safe where `fetch` is not, and it is a one-line asymmetry:
`URLSession.shared`'s completion handler runs on the **session's own delegate
queue**, never on main. So the request completes and signals a semaphore while
main is blocked, and the wait returns
(`ReactWatchRuntime/DebugPollTransport.swift`). The fetch bridge is unusable
here precisely because it does the extra hop back onto the JS queue that makes
it a good citizen everywhere else.

Two deliberate placements:

- **Not on `__host`.** The generated bridge (`codegen/schema.ts` →
  `HostBridge.swift`) is compiled into release builds and every method on it is
  an ARCH-01 capability an OTA bundle may declare. A debugger must be neither.
  `__debugPoll` is installed as a bare global under `#if DEBUG`, exactly the way
  `__inspectorUrl` already is in `installFreshRuntime()`.
- **Installed unconditionally in DEBUG.** Only an *instrumented* bundle ever
  calls it; an ordinary one has no probes. And if no `react-watchos debug` is
  running, the first exchange fails, returns the empty string, and the probe
  **detaches for the rest of the runtime's life** — one refused connection, not
  a poll loop.

Blocking main freezes the UI while paused. That is what a breakpoint is. It is
also the second reason none of this may exist in a release build.

## 5. The pieces

### 5.1 The wire (`js/src/debugWire.ts`)

One exchange, watch-initiated, JSON both ways:

```jsonc
// -> the dev server
{ "v": 1, "state": "paused", "reason": "breakpoint",
  "frames": [ { "file": 0, "line": 13, "name": "add",
                "args": { "a": "0", "b": "0" } }, … ],   // top frame first
  "evaluated": { "seq": 1, "result": "0" } }             // answer to a previous command

// <- the watch
{ "v": 1,
  "breakpoints": { "0": [13] },                          // COMPLETE set, fileId -> lines
  "action": "continue" | "next" | "stepIn" | "stepOut" | "pause" | null,
  "evaluate": { "seq": 1, "expression": "b" } | null }
```

`action: null` means "keep waiting" — the dev server long-polls for ~1 s before
answering that, so a paused watch is not a busy loop on the network.

### 5.2 The transform (`js/esbuild/debug-probe.mts`)

A Babel pass behind an esbuild `onLoad`, registered only when
`watchBuildOptions({ debug: true })`.

- **Statements** get `__dbg(fileId, line)` inserted before them, in
  `Program.body`, `BlockStatement.body` and `SwitchCase.consequent`, on the
  visitor's `exit` so children are already done and nothing is re-traversed.
  Declarations and module syntax are skipped (a probe "before" a hoisted
  function declaration would report a line that never runs).
- **Functions** with a block body get
  `__dbg_p(fnId, [params…]); try { … } finally { __dbg_o(); }`. The `finally`
  is not defensive politeness: an exception thrown through an instrumented
  frame would otherwise desynchronize the shadow stack for the rest of the
  process's life, and the first thing anyone debugs is a throw.
- **Per file**, a prologue `__dbg_r(startId, [[name, fileId, line, params], …])`
  registers the function table, so call sites carry an integer instead of a
  string and an array literal.
- **`<outfile>.dbg.json`** records, per instrumented file, its absolute path and
  every line that carries a probe. That is what maps a DAP `source.path` to a
  `fileId` and what lets the adapter *move* a breakpoint honestly.

Three decisions inside the transform that are not obvious:

- **The React Compiler is off in a debug build.** They both want the same
  esbuild `onLoad`, and esbuild runs only the first plugin that returns a
  result — so registering both would silently mean "only the debug one runs".
  Running them in sequence is worse: the compiler rewrites the code before we
  could read its line numbers, and a debugger whose lines are off by a
  memoization block is worse than no debugger. `reactCompiler` is documented as
  ignored when `debug` is on.
- **Third-party code is never instrumented**, and this package's own `src/` is
  not either by default (`debugIncludeRenderer` opts in). React plus the
  reconciler are most of the module graph and none of it is code anyone sets a
  breakpoint in. §6 measures what the opt-in costs.
- **One inject entry, not two.** The probe runtime must be evaluated before the
  first instrumented statement, including the ones inside the injected shims.
  `inject: [probe, shims]` does *not* guarantee that — the emitted bundle ran
  `src/fetch.ts` (a shim dependency) before the probe module and died on
  `__dbg_r is not defined`. The preset now injects a single virtual module whose
  body is `import probe; import shims;`, making the order an ESM guarantee
  instead of an esbuild implementation detail.

### 5.3 The runtime probe (`js/src/debugProbe.ts`) and the adapter (`js/bin/dap-session.mts`)

The hot path is the whole budget, so it is short:

```ts
function probe(file: number, line: number): void {
  top.file = file;                       // 2 stores: the current frame's position
  top.line = line;
  if (stepMode !== null) { … }           // 1 null compare
  if (armed) { … }                       // 1 boolean test, object lookup only if set
  if (detached) return;
  if (--ticks > 0) return;               // 1 decrement: the throttle for the
  …                                      //   running check-in (Date.now every 2000)
}
```

`armed` is false whenever no breakpoint exists, which skips the lookup
entirely; `detached` is set the moment the host hook proves absent, which is
the state every instrumented bundle without a debugger attached runs in.

The adapter is transport-agnostic by construction — it imports nothing from
`node:` — because that is what let the integration test run the *real* adapter
inside quickjs-ng rather than a mock of it (§7). It implements `initialize`,
`launch`/`attach`, `configurationDone`, `setBreakpoints`,
`setExceptionBreakpoints` (accepted and ignored), `threads`, `stackTrace`,
`scopes`, `variables`, `continue`, `next`, `stepIn`, `stepOut`, `pause`,
`evaluate`, `disconnect`/`terminate`. Anything else gets an explicit
"unsupported" error response rather than silence.

Three behaviours worth knowing:

- **A breakpoint moves to the next instrumented line.** Set one on
  `export function add(…)` and the response verifies it at the `const sum = …`
  below, per the DAP contract quoted in §2.
- **`evaluate` is answered before the resume verb.** The adapter parks the DAP
  request, sends the expression on the next exchange, and responds when the
  watch answers — because resuming first would destroy the frame the expression
  refers to.
- **Disconnecting leaves the app running and un-breakpointed.** Detaching a
  debugger from a watch must not strand it parked on a line nobody is watching.

### 5.4 Keeping it out of release

The existing `REACT_WATCH_DEV` define is *necessary but not sufficient* here.
That define makes dead code tree-shakeable; it does not stop a transform from
running. So the gate is stronger: the transform is an esbuild plugin that is
**only registered when `debug: true`**, and the probe runtime is reached only
through the inject the same flag installs. A shipping build has no probes to
fold away because it never had any.

Three layers, in order of how loud they fail:

1. `buildBundles` / `react-watchos build` never pass `debug` — and
   `build --debug` is refused with a sentence rather than accepted, because
   `build` is the shipping entry.
2. `watchBuildOptions({ debug: true })` forces the dev define on, so an
   instrumented bundle can never claim to be a shipping one.
3. A test asserts a production build contains no `__dbg` **anywhere** — not "no
   probe calls", no occurrence of the identifier at all, which also catches the
   runtime module leaking in with every call site folded away.

## 6. The measured cost

`node --experimental-strip-types js/scripts/debug-overhead.ts --runs 9` builds
the demo app bundle three ways and runs each through
`tools/embed-smoke/embed-host.c` — the exact embedding sequence
`JSRuntime.swift` uses, linked against the vendored quickjs-ng. Medians of 9
runs, Linux dev container, 2026-08-21. Measured **detached** (no `__debugPoll`
installed), which is what a developer running an instrumented bundle actually
pays; all three shapes are built with the React Compiler off so the delta is
the probes alone.

| shape | bytes | vs base | parse ms | eval ms | boot ms | vs base | heap MB | per tap ms | vs base |
|---|---|---|---|---|---|---|---|---|---|
| baseline (dev, no probes) | 594,476 | — | 29.6 | 3.5 | 33.1 | — | 1.9 | 0.566 | — |
| **debug (app code)** | **625,560** | **+5.2 %** | 31.0 | 3.6 | **34.6** | **+4.5 %** | 2.0 | **0.572** | **+1.1 %** |
| debug (app + renderer) | 690,762 | +16.2 % | 34.7 | 4.9 | 39.9 | +20.5 % | 2.2 | 0.762 | +34.6 % |

"per tap" is `tools/embed-smoke/bench-epilogue.js`: one full interaction —
React render, full-tree serialize, `JSON.stringify`, commit — averaged over 200
dispatches after 20 warm-up taps. It is the number boot time cannot see, and it
is the one that decides whether you can leave the flag on.

Reading the table:

- **The default configuration is cheap enough to ignore.** +5.2 % bytes and
  +1.1 % per interaction is not a reason to think twice about `dev --debug`.
- **The parse/eval split says where the bytes go.** Parse scales with size
  (+1.4 ms for +31 KB); eval barely moves (+0.1 ms), because at boot most
  probes run once.
- **Instrumenting the renderer costs 30× more per interaction than
  instrumenting app code** (+34.6 % vs +1.1 %), which is the entire
  justification for `debugIncludeRenderer` defaulting to off: the renderer's
  hot loops run per node per commit, and app code does not.
- Boot and tap numbers are **dev-hardware-relative wall clock**. The ratios
  travel; the absolute milliseconds do not.

The full instrumented demo app — every screen, the reconciler, widgets, 220
dispatched interactions — runs correctly through the reference C host, which is
the incidental proof that the transform does not change behaviour.

## 7. What is tested, and how honestly

`js/test/dap-debugger.test.ts`, 10 cases. The centrepiece runs **in the vendored
quickjs-ng**, the same sources SwiftPM compiles for watchOS:

- the fixture is instrumented by the real transform through the real preset;
- the **real `DapSession`** is bundled into the harness and driven by a scripted
  DAP client that reacts to `stopped` by asking for `stackTrace`, `scopes` and
  `variables` and then sending the next verb — the conversation VS Code has,
  minus the socket;
- `__debugPoll` is wired straight to `session.poll`, so the probes obey commands
  that came out of the adapter, not out of a mock.

It asserts the pause/step/continue *order* and the reported *stack lines*:

```
breakpoint  add:13   run:20   (module):25     evaluate "b" -> "0"
step (next) add:14   run:20   (module):25
step (out)  run:20   (module):25
step (in)   add:13   run:20   (module):25
breakpoint  add:13   run:20   (module):25     args a="1" b="2"
                                              → program completes, result 3
```

Plus: the requested breakpoint on line 12 (a declaration) is verified at 13; the
manifest lists exactly the executable lines and nothing else; a production build
contains no `__dbg`; the DAP `Content-Length` framing round-trips a multi-byte
body split across 7-byte chunks; and the real HTTP + TCP server carries a
session end to end.

`js/swift/Tests/ReactWatchTests/DebugPollTests.swift`, 3 cases, gates the
transport property nothing in JS can see: that `__debugPoll` returns the
handler's answer **as the value of the call**, that the paused loop can exchange
more than once without the JS thread yielding, and that the global is absent
until installed.

**Not tested here, and I will not claim otherwise:** the watchOS wiring in
`ReactWatchHost.swift` (the `debugPollURL` constant and the `installDebugPoll`
call in `installFreshRuntime`). That file is `#if os(watchOS)` and is not
compiled by any gate that runs on Linux — `swift build`/`swift test` build it to
an empty module. It is twelve lines mirroring the adjacent `devBundleURL` /
`__inspectorUrl` code exactly, and it needs an `xcodebuild` run on a Mac before
anyone should believe it.

## 8. What this prototype does NOT do

Stated plainly, in the spirit of `docs/debugging.md`'s "What this is NOT".

- **No scope walker.** `scopes` returns one scope, named **Arguments**, and it
  contains exactly the function's plain-identifier parameters, captured at
  entry. A `const` declared inside the body, a closure variable, `this`, a
  destructured or rest parameter — none of them are visible. Calling that scope
  "Locals" would promise something the design does not do. Getting real locals
  means either a scope-capture transform (a closure per call, measurable in §6
  terms) or engine support (C1).
- **`evaluate` sees the captured arguments and global scope, nothing between.**
  It resolves an expression against the top frame's captured arguments first,
  then falls back to an *indirect* `eval`, which is global-scope by
  specification. There is no `evaluate` in a middle frame.
- **Statement granularity, not expression granularity.** Stepping out of a call
  lands on the caller's *next statement*, not the middle of the line that made
  the call. Breakpoints can only sit on lines that carry a probe; the adapter
  moves them and says so.
- **`async`/generator frames drift.** The shadow stack pushes on entry and pops
  in `finally`, so a frame suspended at an `await` stays on the stack while
  other code runs. Synchronous code — which is all of React's render path — is
  correct. This is the sharpest edge in the design.
- **No conditional breakpoints, no function breakpoints, no logpoints, no
  `setVariable`, no exception breakpoints, no restart, no step-back.**
  `setExceptionBreakpoints` is accepted and ignored: the probe sits at statement
  boundaries and never sees the engine's exception path.
- **No hot-attach to a paused program.** `pause` is honoured at the next running
  check-in, which is throttled to ~500 ms; a tight loop with no probes in it
  (all in third-party code, say) will not be interruptible.
- **One editor at a time.** A second DAP connection is dropped rather than
  multiplexed. Hermes has the same limit and Metro needed a proxy to lift it.
- **Widgets are not debuggable.** The widget runtime has its own queue and its
  own bundle and is never dev-served; nothing here was wired into it.
- **The React Compiler is off in a debug build** (§5.2), so an instrumented
  bundle re-renders more than the shipping one. Do not read commit counts off a
  debug build.
- **The watchOS wiring is unverified** (§7).

## 9. If this is picked up

In the order that removes the most doubt per unit of work:

1. **Verify on hardware.** `xcodebuild` the host on a Mac, run
   `react-watchos dev --entry … --debug` + `react-watchos debug`, and attach VS
   Code with `{"type":"node","request":"attach","debugServer":8791}`. Everything
   above this line is proven in the engine but not on a wrist.
2. **Decide the async-frame story.** Either mark suspended frames and report the
   stack as approximate, or stop instrumenting `async` functions and be honest
   that you cannot stop inside one. Guessing silently is the wrong option.
3. **Locals, if the arguments-only scope proves too thin in practice.** The
   cheap version is a per-function `eval` capture closure behind a second flag,
   measured against §6 before it is default.
4. **Fold `debug` into `react-watchos dev`** as one process (two ports, one
   command) once the shape stops moving.
5. **A `launch.json` snippet in the scaffold**, so attaching is copy-paste.

## See also

- [debugging.md](./debugging.md) — the five surfaces that exist regardless, and
  the local repro loop this was built on top of.
- [prior-art.md](./prior-art.md) — the renderer-level survey; this document is
  the debugger-level one.
- [budgets-and-limits.md](./budgets-and-limits.md) — the budgets §6 is measured
  against.
