# Prior art: production React custom renderers

Where this project sits among the React renderers that ship in production,
and which of their techniques we adopt, skip, or defer. Grounded in the
[awesome-react-renderer](https://github.com/chentsulin/awesome-react-renderer)
list and the architecture write-ups linked below.

## The landscape

Every one of these is `react-reconciler` (or an equivalent host config) with
a different *target*. React stays the same; the renderer decides what a
"host instance" is and how commits become real output.

| Renderer | Target | Commit model |
|---|---|---|
| [react-native](https://reactnative.dev/architecture/render-pipeline) (Fabric) | UIKit / Android views | C++ shadow tree, **diffed → minimal mutations**, layout off-main, mount on-main |
| [Raycast](https://www.raycast.com/blog/how-raycast-api-extensions-work) | AppKit (separate process) | JSON render tree, **JSON Patch diff + gzip** over IPC |
| [react-three-fiber](https://github.com/pmndrs/react-three-fiber) | three.js scene graph | mutates three objects in place; `useFrame` for per-frame |
| [Ink](https://github.com/vadimdemedes/ink) | terminal (ANSI) | **Yoga** flexbox layout → string, redraws on change |
| [react-pdf](https://react-pdf.org/) | PDF documents | renders a layout tree once, serializes to PDF |
| [Remotion](https://www.remotion.dev/) | video frames | deterministic render per frame number |
| [react-figma](https://react-figma.dev/) / react-sketchapp | design documents | maps props → native design-node attributes |
| [react-tvml](https://github.com/sergioramos/react-tvml) | tvOS TVML (in JSC) | React → TVML document |
| react-nil | nothing (headless) | runs React for effects/tests, no host output |
| **react-native-watchos (this)** | **SwiftUI** | **full JSON tree per commit; SwiftUI does the diff/layout/mount** |

## What we borrow

- **Custom reconciler → serialized tree → native render** is the shared
  backbone of RN, Raycast, react-tvml, react-figma, and us. We're a
  textbook instance of it.
- **Delegate layout + diffing + mount to the native UI framework** (here
  SwiftUI). Ink reimplements flexbox with Yoga; RN ships Yoga + a C++
  diff; we do neither because SwiftUI already diffs an immutable view tree
  and lays it out. This is why we're ~5k LOC, not a framework.
- **Declarative self-updating primitives** instead of per-frame JS:
  `<TimerText>` → SwiftUI `Text(timerInterval:)`, and the widget timelines.
  Same spirit as r3f's `useFrame` being the *exception*, not the rule —
  push the target once, let the host animate.
- **No-op commit bailout** (added now): production reconcilers never push a
  commit that changes nothing. `WatchRoot` now skips a native push when the
  serialized payload is byte-identical to the last (the seq lives in the
  payload, so identity covers the ack too).
- **Registered-message host surface** (capability security), like Raycast's
  whitelisted operations.

## What we deliberately skip (scale-gated)

These are correct for the systems that use them and **wrong for us right
now** — adding them would be speculative complexity at watch-tree scale:

- **JSON Patch / minimal-mutation commits** (Raycast, RN-Fabric). They diff
  because trees are large (hundreds of rows) and cross a process / thread
  boundary. Our trees are tens of nodes and the "IPC" is an in-process C
  call; SwiftUI re-diffs the decoded tree anyway. **Trigger to adopt:** a
  `List` screen large enough that per-commit serialize+decode shows up in a
  profile.
- **Off-main-thread JS** (RN's JS thread). Engine work is sub-millisecond on
  watch trees; we moved only the commit *decode* off-main. **Trigger:** a
  render or handler heavy enough to drop a frame.
- **gzip on the wire** (Raycast). For in-process bytes it's pure overhead.
- **Worker isolation + per-extension memory limits** (Raycast). We're
  first-party; relevant only if this ever loads untrusted watch "mini-apps".

## What we have that the survey suggests productionizing

Already done this session, motivated by the same comparison: **codegen** of
the wire model (RN's codegen / Raycast's typed-clients-per-side),
**bytecode precompile** (Hermes AOT analog), **error boundaries**,
**accessibility**, and **CI**. Remaining productionization ideas if this
graduates out of the playground: React DevTools (`injectIntoDevTools`, as
r3f/Ink wire up), Suspense for async watch data, and a codemod for wire
`v:` bumps (Raycast's migration tooling).

## Sources

- React Native render pipeline (Render/Commit/Mount, shadow-tree diff):
  <https://reactnative.dev/architecture/render-pipeline>
- How Raycast API extensions work (custom reconciler, JSON Patch):
  <https://www.raycast.com/blog/how-raycast-api-extensions-work>
- A technical deep dive into the new Raycast:
  <https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast>
- awesome-react-renderer:
  <https://github.com/chentsulin/awesome-react-renderer>
- Building a custom React renderer (host config primer):
  <https://blog.openreplay.com/building-a-custom-react-renderer/>
