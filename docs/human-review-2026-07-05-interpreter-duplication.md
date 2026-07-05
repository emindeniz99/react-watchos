# Human review — the two SwiftUI interpreters (2026-07-05)

**Reviewer:** hand review (both interpreter files read end-to-end, line by line),
not a token-matcher. It exists because `jscpd` reported **0 exact clones**
between the two interpreters (its token matcher is defeated by the differently
structured code *around* the duplicated helpers), while a plain `diff` shows
`systemColor(_:)` is **byte-identical**. jscpd undercounts this duplication; a
human read is the only way to size it honestly. This is the evidence base for
the **ARCH-10** decision (consolidate the interpreters) — see
[docs/design-shared-interpreter-2026-06-25-1855.md](./design-shared-interpreter-2026-06-25-1855.md).

Files reviewed:

- [`NodeView.swift`](../js/swift/Sources/ReactWatchHost/NodeView.swift) — the
  **app** interpreter (ReactWatchHost), 1473 lines, interactive.
- [`ReactWidgetView.swift`](../js/swift/Sources/ReactWatchWidget/ReactWidgetView.swift)
  — the **widget** interpreter (ReactWatchWidget), 621 lines, static.

Both are `#if os(watchOS)`, both import SwiftUI/Charts, both walk the same
`RNNode` wire tree and share the pure `RNStyle`/`RNFormat` kernels already.

## 1. What is actually duplicated (hand-measured)

Grouped by how safe each is to share.

### Group A — pure SwiftUI-mapping helpers, byte- or near-identical (~150 lines)

These are pure functions of `(RNNode | String | primitives) -> SwiftUI value`.
No `model`, no events, no `@State`. This is the clean extraction target.

| Helper | App (NodeView) | Widget (ReactWidgetView) | Status |
|---|---|---|---|
| `systemColor(_:)` (18-case name→Color) | 781–803 | 501–523 | **byte-identical** |
| `semanticFont(_:)` (10-case → Font) | 552–565 | 433–446 | **byte-identical** |
| `chartMark(kind:point:index:color:)` | 419–454 | 379–414 | **byte-identical** |
| `horizontalAlignment` / `verticalAlignment` / `zAlignment` | 749–778 | 542–571 | **byte-identical** (free funcs in widget, static methods in app) |
| `color(_:)` (RNStyle.color → named/rgba) | 735–747 | 492–499 | same logic |
| `styled(_:)` (bold/mono/font/color on a Text) | 383–394 | 355–366 | same logic |
| `cgFloat` / `formatted` | 728–730 / 521–523 | 485–487 / 481–483 | identical |

### Group B — the layout/appearance chain, structurally duplicated (~80 lines)

Same props, same `RNStyle` parsing, same documented application order
(`padding → background+cornerRadius → frame → opacity → tint`), different
struct names, and the widget is a strict subset (no animation, no glass):

- App: `LayoutModifier` + `PaddingModifier` / `BackgroundModifier` /
  `FrameModifier` / `TintModifier` (1334–1458).
- Widget: `applyLayout` + `padded` + `WidgetBackground` / `WidgetFrame` /
  `WidgetTint` (72–99, 573–619).

`WidgetBackground` and `BackgroundModifier` are line-for-line the same;
`WidgetFrame`/`FrameModifier` and `WidgetTint`/`TintModifier` likewise.

### Group C — the `render`/`rendered` switch — NOT a delete-the-duplicate case

Same node vocabulary, **deliberately different leaves**: the widget degrades
interactive/presentation/navigation nodes (Button → intent-only, Alert/Sheet →
`EmptyView`, Slider/Stepper → read-only `ProgressView`, Map → placeholder,
NavigationStack → root-route-only). This overlap is *intentional divergence*,
not copy-paste — it is the Phase B problem, not the Phase A one.

### Group D — the once-per-type "unsupported node" logger

`unsupportedNode` (NodeView 16–28) and `unsupportedWidgetNode`
(ReactWidgetView 9–25) are the same `OSAllocatedUnfairLock(Set<String>)` +
`Logger` idiom with different subsystem strings. Minor; shareable with a
subsystem parameter.

## 2. Bug found during the review — rich-text nesting drift (LOW, real)

The duplication has already caused a genuine parity divergence.

- **App** `textSegment` ([NodeView.swift:528](../js/swift/Sources/ReactWatchHost/NodeView.swift#L528))
  **recurses** into a segment's element children:
  `node.children.reduce(Text(text)) { $0 + Self.textSegment($1) }`. The author
  documents why (line 532): *"a segment with element children has text=\"\"
  (serialize forces it) and carries its content as nested `<Text>` — fold those
  in first."*
- **Widget** `textSegment` ([ReactWidgetView.swift:418](../js/swift/Sources/ReactWatchWidget/ReactWidgetView.swift#L418))
  **does not recurse** — it builds `Text(node.string("text") ?? "")` and stops.

**Consequence:** a rich-text tree nested ≥2 deep, e.g.
`<Text>a<Text>b<Text>c</Text></Text></Text>`, renders `abc` in the app and
`a` in the widget (the intermediate segment has `text=""` and its `c`
grandchild is dropped). It **degrades silently** (drops text, no crash), which
is why neither the build nor the M6-interim golden parity test caught it — the
golden test does not cover ≥2-deep nested `<Text>`.

**Fix:** either a one-line hotfix (make the widget `textSegment` recurse like
the app's), or — better — let **ARCH-10 Phase A** delete the second copy so the
two *cannot* drift again. Recommend carrying it with Phase A; flag here so the
choice is explicit, not silent.

**Follow-up:** extend the parity golden test with a ≥2-deep nested `<Text>`
case so this class of drift is caught mechanically going forward.

## 3. Recommendation — do ARCH-10 Phase A now, defer Phase B

**Phase A — extract Groups A, B, D into a new watchOS-only `ReactWatchUI`
module** both interpreters import.

- **Safe.** These are pure `(node) -> SwiftUI` mappings with no dependency on
  `model`, events, or view identity. Parity is currently enforced by a golden
  test (M6-interim); sharing one copy makes parity **structural** — strictly
  stronger than a test that has to remember to cover every prop. It also
  *auto-fixes* the §2 drift.
- **DX-neutral.** Every helper here is `private`/`static`/free-function — none
  is public API. Consumers write TSX and never see `NodeView` /
  `WidgetNodeView`. Nothing on the JS/DX surface changes; only our own
  maintenance surface shrinks. The new module is `#if os(watchOS)` like the two
  callers, so Linux `swift test` is unaffected (compiles empty off-watchOS).
- **Scope:** ~230 lines collapse to one copy. No behavior change intended; the
  golden parity test + `swift test` are the guardrail.

**Phase B — unify the `render` switch behind a `RenderContext`** (interactive
vs static) is the higher-risk change: it touches every case and the whole
degradation matrix, where a subtle regression could hide. Do it as a **separate,
later** step once Phase A has removed the easy duplication and the parity test
is extended. Don't fold B into A.

## 4. Other observations (not blocking)

- **Alignment helpers differ only in form** (free functions in the widget,
  `static` methods in the app) — Phase A should pick one form.
- **The a11y application differs by design:** the app uses an `A11yModifier`
  struct; the widget inlines `applyA11y` because widget subtrees expand some
  nodes (Grid rows, nav root) in place. Keep the inline widget path — it is a
  real structural difference, not laziness.
- **`RNStyle`/`RNFormat` sharing is already exemplary** — gauge bounds, clamped
  int, color parsing, chart points, timer/value formatting all live in the
  pure, Linux-tested kernel. Group A is the natural continuation of that work,
  one layer up (the SwiftUI mapping the kernel deliberately stops short of).
