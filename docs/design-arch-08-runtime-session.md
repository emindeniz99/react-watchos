# ARCH-08 — RuntimeSession isolation (design — deferred, low-urgency)

**Status:** design-first; not greenlit for implementation. Scoping note so the
work is well-defined when it's picked up.

> **2026-07-27 — SUPERSEDED IN SCOPE, and one claim below is refuted.**
> ARCH-08 shipped under a different scope (see the re-scoped heading in
> `system-architecture-review-2026-06-25-1859-codex.md`): a JS
> `WatchRoot.dispose()` paired with `runApp`'s globals, a single-active-root
> guard, the inspector diagnostics-tap fix, and a queue-confined
> `JSRuntime.shutdown()`. No `RuntimeSession` type was created on either side.
>
> This doc is kept as the historical record of the *other* reading of ARCH-08
> (the Swift per-runtime-correlation seam) and is deliberately NOT rewritten —
> two competing acceptance lists for one ID is a rule 7 conflict, and the
> resolution is: **the codex review's heading is the ID of record; this doc's
> acceptance list is not tracked.** What survives here as real, unshipped work
> is one bullet — rejecting the old generation's in-flight BLE Promises loudly
> instead of dropping them — which is carried forward as its own backlog note.
>
> **"Why it's deferred (no failing scenario today)" is wrong.** Two failing
> scenarios were found on 2026-07-27:
> 1. a second `runApp` in the same context silently double-mounted (root #1
>    stayed mounted; correction, 2026-07-27: it does NOT keep receiving native
>    pushes — `nativeEvents` is module-scope too, so root #1's listeners stay in
>    the old IIFE's table. It is a leak, not double-delivery.) `runApp` now
>    throws on a second mount within one evaluation; the same-context
>    RE-evaluation case (the OTA→shipped fallback, where the second `evaluate`
>    gets a fresh module scope) is covered by the `__disposeActiveRoot` global
>    the host calls before each bundle eval;
> 2. `JSRuntime` was freed on whatever thread dropped the last reference, which
>    for the OTA validator/compiler and the widget runtime is never the owning
>    queue — a staged bundle that arms a `setTimeout` at module scope makes that
>    a data race plus a use-after-free, reachable from a signed OTA bundle.
>
> Both are fixed. The claim stands only for the narrow thing this doc actually
> analysed: the *abandoned-Promise* seam below really is cosmetic.

## What it is

Today the watch host (`ReactWatchModel`) mixes two lifetimes of state with no
boundary between them:

- **Per-runtime state** — recreated on every boot/reload. The host already
  news a fresh `JSRuntime` each reload (`ReactWatchHost.swift`: `runtime = nil`
  → `runtime = js`), so the **JS module globals reset** (new QuickJS context),
  and a `generation` counter (CX-008) makes a late async callback from the old
  generation a no-op against the new runtime.
- **Persistent transport state** — deliberately kept across a dev hot-reload:
  the `WCSession` link, the `CBCentralManager` connection, sensor subscriptions
  (`ReactWatchHost.swift` comment: "a stateful link we don't want to drop on a
  dev hot-reload").

The gap ARCH-08 names: the **bridge *correlation* state** sits with the
persistent objects but logically belongs to the runtime. After CX-022, a
`BluetoothBridge` keeps its `BleSession` (pending invoke ids) across a reload;
a fetch/generate in flight is correlated by id. On a hot-reload, those old ids
settle against the *new* runtime's invoke map — which drops them (settle-once +
unknown-id no-op), so the old op's Promise is **silently abandoned** rather than
rejected. No crash, no mis-settle — just an untidy seam.

## Why it's deferred (no failing scenario today)

Three existing mechanisms already make this safe, just not *clean*:

1. fresh `JSRuntime` per reload → JS globals never accumulate;
2. the `generation` guard → no old async settles a new runtime;
3. JS `invoke`/event settle-once + unknown-id no-op → a stale native settle is
   harmless.

So ARCH-08 buys **correctness-by-construction and clarity**, not a bug fix. That
makes it the wrong thing to refactor blind at the tail of a feature push — the
risk (touching the core runtime/host wiring) outweighs the reward until it's
designed and there's a reason to spend it.

## The shape, when it's done

Introduce a `RuntimeSession` that owns exactly the per-runtime state:

- the `JSRuntime`, the `generation`, and the **per-runtime correlation** —
  fetch/generate/invoke pending maps, and each bridge's per-runtime bookkeeping
  (`BleSession`, sensor request ids).
- Persistent transport (`WCSession`, `CBCentralManager`, sensor managers) stays
  on the host and is *handed* a session; on reload the host swaps the session
  and the bridges **reject/clear** the old session's pending (so a hot-reload
  mid-BLE-op rejects the Promise loudly instead of abandoning it).

This also subsumes OP-2's thread-safety note (the per-runtime state gets one
owner with a clear isolation domain, instead of `assertMainThread` spot-checks).

## Acceptance

- [ ] `RuntimeSession` owns runtime + generation + per-runtime correlation.
- [ ] Reload swaps the session and rejects the old session's in-flight Promises
      (BLE/fetch/generate) loudly, not silently.
- [ ] Transport links (WC/BLE/sensors) survive a hot-reload unchanged.
- [ ] Pure session-swap logic is Linux-unit-tested.
