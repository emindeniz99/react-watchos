# Design note — one shared SwiftUI interpreter (SD-2)

Short pre-code note for SD-2 from the
[system-design review](./system-design-review-2026-06-25-1824-opus.md). Subsumes
CX-018 (drift), CX-024 (contract), and folds in CX-015/CX-017.

> **Pre-release:** nothing shipped — delete `WidgetNodeView` outright, no compat
> shim, no gradual migration.

## Problem

`NodeView` (app) and `WidgetNodeView` (widget) are two independent hand-written
switches over the *same* wire tree. They already diverge — widget `color` has no
hex ([WidgetNodeView.swift:200](../app/targets/widget/WidgetNodeView.swift) vs
[NodeView.swift:432](../js/swift/Sources/ReactWatchHost/NodeView.swift)),
`styled` drops `monospacedDigit`, `timerText` ignores `milliseconds`. Two
interpreters of one protocol drift forever; every new primitive needs two edits.

## Target shape

One interpreter, parameterized by context, in a new module both processes import.

```
ReactWatchCore      (wire structs — exists)
ReactWatchSupport   (pure parsing — exists; gains the helpers below)
ReactWatchUI   ←──   NEW, watchOS-only: the single NodeView + RenderContext
   ├── ReactWatchHost   (app: interactive=true,  real dispatcher)
   └── widget extension (widget: interactive=false, no-op dispatcher)
```

### 1. Move pure parsing down to `ReactWatchSupport` (Linux-tested)
Return *data*, not SwiftUI types, so it builds on Linux and both interpreters
share one implementation:
- `RNColor.parse(_:) -> RNColor?` (named set **+ hex** `#RGB[A]` → RGBA) — kills the hex drift.
- `semanticFont(_:) -> RNFontStyle` (enum), `formatValue(_:)`, `timerInterval(...)`.
The SwiftUI layer maps `RNColor`→`Color`, `RNFontStyle`→`Font`.

### 2. One `NodeView` in `ReactWatchUI`, driven by a `RenderContext`
```swift
struct RenderContext {
    let interactive: Bool          // app = true, widget = false
    let dispatch: (RNEvent) -> Void // app → ReactWatchModel; widget → no-op
}
```
- A single `switch node.type`. Interactive controls (Toggle/Slider/Picker/…)
  attach bindings + `dispatch` **only when `interactive`**; in the widget the
  same cases render the read-only form (the current `WidgetNodeView`
  degradations become `else` branches of one switch, not a second file).
- The **injected `dispatch`** is the seam that lets one view serve both
  processes — the app routes to `ReactWatchModel.dispatchOptimistic`, the widget
  passes a no-op. No `EnvironmentObject` dependency inside the shared view.
- CX-015 (Map region) and CX-017 (relevantContexts) get implemented **once**
  here.

### 3. Delete `WidgetNodeView`; point the widget at `ReactWatchUI`.

### 4. Golden contract test (CX-024)
One test enumerates **every primitive × {app, widget}** and asserts the expected
rendering/degradation, so a new primitive can't silently skip widget support.
Most of it runs as a pure/snapshot test on the shared helpers; the SwiftUI bits
stay in the macOS host test.

## Out of scope here
- CX-016 (snapshot picks a future entry) — that's timeline *selection* in
  `ReactTimelineProvider`, not interpretation. Fix separately.
- Generating the primitive list from schema — that's SD-6; this note assumes the
  hand-written switch, SD-6 later feeds it the support matrix.

## Risk
The widget extension's tight memory budget is unchanged (same engine, same
tree); the shared view adds no runtime cost — it's a compile-time
unification. Main work is mechanical: move ~6 helpers, merge two switches,
re-point one import.
