# How React updates commit (and serialization quirks)

A short guide to the two things that surprised the first consumer. Read it
before debugging a "my `setState` didn't show up" or a tree-assertion mismatch.

## The commit model: what flushes, what doesn't

The renderer runs React **synchronously** — there is no concurrent scheduler
loop ticking in the background. A render commits a tree to the host only on
these paths:

| Path | Commits? | Use it for |
|---|---|---|
| `runApp(element)` initial render | yes | first paint |
| `dispatchEvent(...)` (a tap/onChange from native) | yes, synchronously | user interaction |
| `runSync(fn)` | yes, synchronously | native pushes (sensors, BLE, phone msgs) |
| a real `setTimeout` / `setInterval` callback firing | yes | clocks, polling, deferred work |
| a bare `setState` in module scope or a microtask, with **no** enclosing sync path | **no** | — |

The trap: code that calls `setState` outside any of the above (e.g. resolving a
promise in a `useEffect` with nothing driving a flush) updates React's internal
state but **never commits**, so the UI silently doesn't change. Historically
this surfaced as the cryptic *"Expected host context to exist."*

What to do instead:

- **External state → push + `runSync`.** Native code calls
  `__pushNativeEvent(name, json)`; your `registerNativeListener(name, cb)`
  callback runs inside `runSync`, so any `setState` it does commits immediately.
  This is the channel BLE/sensors/WatchConnectivity already use.
- **Clocks → `<TimerText>`, not a per-second `setState`.** It ticks natively in
  SwiftUI with zero per-frame JS (use the `until` prop for countdowns).
- **Deferred/periodic work → real timers.** `setTimeout`/`setInterval` are
  shimmed onto the host timer and *do* drive a commit when they fire.

`dispatchEvent` also acks the event `seq` even when the handler causes no
re-render, so native optimistic controls aren't left hanging — you don't need
to think about this unless you're writing a new native control.

## Serialization quirks (matter when you assert on trees)

When a tree is serialized for the host (and in tests via `MemoryHost` /
`renderToTree`):

1. **`<Text>` content folds into `props.text`, not `children`.**
   `<Text>Count: {n}</Text>` serializes to `{ type: "Text", props: { text:
   "Count: 3" }, children: [] }`. Assert on `props.text` — or use
   `findByText(tree, "Count: 3")` from `react-native-watchos/testing`.
2. **Function props serialize to the literal `true`.** `onPress`, `onChange`,
   etc. can't cross to Swift, so the wire carries `onPress: true` as a flag that
   the node is interactive. Assert `props.onPress === true`, never a function.
3. **`undefined` props are dropped** entirely (they don't appear on the node).

For querying committed trees in tests, import `findByType` / `findByText` from
`react-native-watchos/testing` instead of re-deriving them.
