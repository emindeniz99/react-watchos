# Focus management (Crown ownership) — design record

The last open Track-1 row: *"Only one Crown-focusable element at a time on
watchOS; needs an addressable focus model. Gates multi-Crown screens."*

The shipped surface is deliberately small — two props and one event, on one
component:

```tsx
function CrownScreen() {
  const [volume, setVolume] = useState(30);
  const [zoom, setZoom] = useState(1);
  const [owner, setOwner] = useState<"volume" | "zoom">("volume");
  return (
    <VStack spacing={6}>
      <CrownRotation
        value={volume} min={0} max={100}
        focused={owner === "volume"}
        onFocusChange={(f) => { if (f) setOwner("volume"); }}
        onChange={setVolume}
      >
        <Gauge value={volume} min={0} max={100} label="Vol" style="circular" />
      </CrownRotation>
      <CrownRotation
        value={zoom} min={1} max={10} step={0.5}
        focused={owner === "zoom"}
        onFocusChange={(f) => { if (f) setOwner("zoom"); }}
        onChange={setZoom}
      >
        <Text bold>{String(zoom)}</Text>
      </CrownRotation>
    </VStack>
  );
}
```

`focused` is a **declarative Crown-focus claim** (edge-triggered, applied when
the committed value changes and when the node appears); `onFocusChange` is the
**observation channel** for focus the system moves without asking (the user
taps the other Crown view). Flip one piece of state and the Crown moves.

## 1. The constraint, stated precisely

`digitalCrownRotation` delivers Crown values only to the view that currently
**has hardware focus**, and watchOS keeps exactly one focus owner at a time.
Our `CrownRotationView` applies `.focusable()` unconditionally (it must — an
unfocusable view never receives the Crown), so a screen with two
`<CrownRotation>`s compiles, renders, and then the *system* picks which one
the Crown drives; JS had no way to say which, to hand it over, or even to know
which one owns it. The same arbitration already involves the implicitly
Crown-focusable natives (Slider, Picker, ScrollView) — this design scopes v1
to the explicit Crown primitive and records the extension axis (§6).

## 2. Prior art first (project rule 3)

### 2.1 SwiftUI — the substrate we bind

The native model (watchOS 8+) is a screen-level `@FocusState` — a `Bool` for
one view (`.focused($isFocused)`) or an enum/optional for several
(`.focused($field, equals: .volume)`). It is a **bidirectional binding**:
setting it moves focus; the system moving focus (a tap, a dismissal) writes it
back. Apple's own docs describe exactly our use case — "programmatically set
and remove focus from the view" and observe it.

The older watchOS 7 vocabulary (`prefersDefaultFocus(_:in:)` + the
`resetFocus` environment action) addresses only *default* focus — which view
starts focused when nothing has it — needs a `@Namespace` plumbed through the
interpreter, and its reset is an imperative environment action with no natural
JSON-wire shape. Rejected as the primary mechanism; the `focused`-on-appear
rule (§3) covers the default-focus need it would have served.

**Verdict: adopt `@FocusState` + `.focused(_:)` (Bool form) as the native
binding, one per `CrownRotationView`.** The enum-typed screen coordinator is
NOT mirrored on the wire: in React the screen-level "enum" already exists —
it is app state — and `focused={owner === "zoom"}` expresses the identical
semantics with no coordinator node, no id namespace, and no new wire type.
SwiftUI's single-owner invariant does the arbitration a coordinator would
otherwise have to re-implement.

### 2.2 React Native TV (react-native-tvos) — the closest RN precedent

The TV platforms are RN's only first-class focus system:

- `hasTVPreferredFocus: boolean` — a declarative claim; the community's own
  guidance is "at most one, or it won't work at all".
- `onFocus` / `onBlur` events — the observation channel.
- `nextFocusForward/Up/Down/Left/Right` + `TVFocusGuideView`
  (`destinations`, `autoFocus`) — a spatial traversal graph for D-pad
  navigation.
- The known pain point: focus on *back*-navigation, patched in userland with
  `useFocusEffect` re-claims.

**Verdict: borrow the boolean-claim + focus-events shape; reject the
traversal graph.** `nextFocus*` and focus guides exist because a TV remote
moves focus *spatially* among dozens of focusables; watchOS has no D-pad —
focus moves by tap or programmatically, and a watch screen has at most a
couple of Crown clients. A traversal API here would be vocabulary without a
platform behind it. The back-navigation pain point is designed away rather
than inherited: our claim is re-applied on node appearance, and ARCH-09 lazy
navigation unmounts inactive routes, so a pop-return re-runs the claim without
any `useFocusEffect` in user code (§3.3).

### 2.3 react-native-windows / RN core / web — imperative `focus()`

RNW and RN core's `TextInput` expose `ref.focus()`/`.blur()` (view-manager
commands) plus a `focusable` prop; the DOM has `autofocus` and imperative
`element.focus()`.

**Verdict: reject the imperative handle.** This renderer has no ref/command
channel — everything crosses as committed props (declarative, replayable) or
as events coming back. An imperative `focus()` would need a new one-shot
command surface in the bridge for zero expressiveness gain over an
edge-triggered prop — and the prop has the property the imperative call
lacks: it *replays on remount*, which is precisely what lazy navigation needs
(the thing tvOS users hand-roll with `useFocusEffect`). This is also the
repo's standing direction: `TextField.autoFocus` is already a declarative
one-shot, not a ref method.

### 2.4 Availability sweep (project rule 2 — verified from Apple's docs JSON)

Fetched from `developer.apple.com/tutorials/data/documentation/…` on
2026-08-21; `introducedAt` for watchOS:

| Symbol | watchOS | Used? |
|---|---|---|
| `@FocusState` | **8.0** | yes |
| `View.focused(_:)` (Bool) | **8.0** | yes |
| `View.focused(_:equals:)` | 8.0 | no — enum form not needed (§2.1) |
| `View.focusable(_:)` | 8.0 | already shipped in `CrownRotationView` |
| `View.focusable(_:interactions:)` | 10.0 | no |
| `View.prefersDefaultFocus(_:in:)` | 7.0 | no — default-focus only (§2.1) |
| `EnvironmentValues.resetFocus` | 7.0 | no |
| `digitalCrownRotation(_:from:through:by:sensitivity:isContinuous:isHapticFeedbackEnabled:)` | 6.0 | already shipped |

Package floor is watchOS 10, so the feature ships **`@available`-free** —
none of the used symbols is beta or deprecated.

## 3. The chosen model

### 3.1 `focused` is a claim, not a controlled value — deliberate CX-010 divergence

Every other interactive prop here is *controlled*: the committed prop is the
truth, optimistic edits are released by seq-ack, and a handler-less control is
disabled so it can't drift. Focus is different in kind: it is **hardware
routing state the OS owns**. The system moves it legitimately without asking
JS first (a tap on the other Crown view, a presentation dismissing), and a
level-enforced `focused` would fight the user — every unrelated commit would
snap focus back. So:

- **Absent `focused`** → uncontrolled, exactly today's behavior. A
  single-Crown screen needs nothing.
- **`focused: true` committed** → claim focus, applied when the committed
  value *changes* and once when the node *appears*.
- **`focused: false` committed** → resign it (a no-op if the view doesn't
  hold focus).
- The claim is **edge-triggered**: after it applies, the system keeps
  arbitration authority. JS observes reality through `onFocusChange` and
  folds it into the state that derives `focused` — the demo's
  `onFocusChange={(f) => { if (f) setOwner("volume"); }}` is the whole
  pattern. An app that claims focus but never folds the observation simply
  can't re-claim after the user taps away (its state still says "mine", so
  there is no edge) — document-level rule, same spirit as the controlled
  inputs, enforced by the same mechanism (you wire the handler) rather than
  by a disable.

**At most one node per screen should claim `focused`.** SwiftUI guarantees a
single focus owner, so several simultaneous claims still converge to one —
but *which* one is unspecified, don't rely on it (the exact rule
react-native-tvos states for `hasTVPreferredFocus`). Handing the Crown from A
to B in one commit (A `false`, B `true`) converges to B in either
apply order: the resign only clears A, the claim sets B.

### 3.2 The wire shape

Two additive props on the existing `CrownRotation` node and one new event —
**wire `v` stays 1** (the repo rule: additive node/prop changes don't bump):

- `focused?: boolean` — crosses as a plain bool.
- `onFocusChange?: (focused: boolean) => void` — a function prop, so the
  serializer folds it to the `true` handler flag like every other handler.
- Event `focusChange`, payload `{ focused: boolean }`, dispatched by native to
  the node whose focus changed; `events.ts` maps it to `onFocusChange` and
  unwraps the boolean (the `change`/`swipe` extraction pattern).

No codegen/schema change is required, and that is itself a recorded decision:
the tree wire carries per-node props as free-form JSON by design
(`RNNode.props: [String: JSONValue]`) — the schema declares components, host
methods and invoke shapes, not per-component props. The cross-language prop
contract is pinned where it always is: the serializer-generated kitchen-sink
fixture, decoded and spot-asserted by `WireContractTests` on Linux.

### 3.3 Composition with ARCH-09 lazy navigation

Inactive routes are not mounted and not serialized, so focus scoping falls out
structurally: a pushed screen's Crown views don't exist until the push
commits, and a popped screen's views cease to exist. The claim-on-appearance
rule then gives, with zero user code:

- **Autofocus on push** — a route whose `CrownRotation` has `focused={true}`
  grabs the Crown when the screen mounts.
- **Restore on pop-return** — screen-local state drops on pop (the documented
  ARCH-09 BREAKING), so the route remounts with its initial `owner` state and
  the claim re-applies. An app that wants the *last* owner restored lifts that
  state above the stack, like any other state it wants to survive a pop.

The 50 ms deferral before the appearance claim is the same one
`OptimisticTextField.autoFocus` already uses — focusing during `onAppear` is
too early in SwiftUI's own sequencing.

### 3.4 The widget path — focus is meaningless, and where that is recorded

A widget snapshot has no focus, no Crown, no events. `CrownRotation` is
already **component-level `degraded`** in the contract (the widget interpreter
renders its children and nothing else — `value`, `min`, `max`, `step`,
`haptic`, `onChange` are all equally inert there), and `focused` /
`onFocusChange` join that set: the widget interpreter reads neither key, so
the props cross the widget wire as inert data, never as behavior.

A `propDegradations` row is deliberately **not** added, for two convergent
reasons. First, that table documents props silently ignored on components that
*otherwise render fully* — adding `focused` alone would misrepresent
`value`/`onChange`/`haptic` as widget-honored. Second, its cross-check demands
extracted evidence that the app reads the prop, and the parity scan cannot see
into `CrownRotationView` (separate `View` structs are outside the scan by
documented design), so the row would fail its own evidence gate. The
component-level `degraded` entry plus this section is the honest record.

### 3.5 Native implementation shape (watchOS-gated)

Each `CrownRotationView` gets a private `@FocusState var focused: Bool` bound
with `.focused($focused)` after the existing `.focusable()`:

- prop→system: `.onChange(of: node.bool("focused"))` applies a changed claim;
  a `.task` applies a `true` claim once on appearance (50 ms deferred).
- system→JS: `.onChange(of: focused)` dispatches `focusChange` with
  `{focused}` — only when the node declared `onFocusChange` (the handler flag
  is on the wire), so an unobserved Crown view costs zero bridge traffic.

No shared coordinator, no environment plumbing: SwiftUI's single-owner
invariant *is* the coordinator (§2.1), and per-node `Bool` bindings compose
with it exactly like multiple `.focused(_:equals:)` tags would.

## 4. Deliberately out (recorded, with the reversal path)

- **Focus traversal order** (`nextFocus*`, focus guides): no D-pad on
  watchOS; focus moves by tap or programmatically. Revisit only if Apple ever
  ships directional focus traversal on the platform.
- **`focused` on the implicitly Crown-focusable natives** (Slider, Picker,
  DatePicker, Stepper, TextField): the same three modifier lines would bolt
  onto each, but no consumer has asked to programmatically hand the Crown to
  a Slider, and `TextField` keeps `autoFocus` (a different semantic — watchOS
  text input is modal and the system still requires a tap; `focused` on a
  Crown view is fully honored). Extension is additive per control, wire v
  unchanged.
- **An imperative `useFocus()` / `focus()` handle**: rejected on protocol
  grounds (§2.3); the edge-triggered prop is the command, with replay.
- **A `FocusScope` / focus-group id node**: id addressing adds a node type
  and a coordinator for semantics `focused={owner === id}` already expresses
  (§2.1). Revisit only if a real screen needs *cross-subtree* focus policy
  that per-node claims can't express.
- **`onFocusChange` on generic `focusable` views**: `GestureProps.focusable`
  marks a view focus-*addressable*; observation there has no consumer and no
  Crown semantics. Same additive path if one appears.

## 5. Verification boundary, stated plainly

**Linux pins (all green in this change):**

- Serialization: `focused` crosses as a bool, `onFocusChange` folds to the
  `true` flag; a two-Crown screen serializes deterministically, and a
  state-driven handoff (fold `onFocusChange` → commit) moves the claim from
  one node to the other (`primitives.test.tsx`).
- Event mapping: `focusChange` dispatches the boolean to `onFocusChange`
  (`events.test.tsx` pattern), including the structured `{handled, accepted}`
  verdict.
- The cross-language wire contract: the kitchen-sink fixture now carries a
  focused Crown node; `WireContractTests` (real `swift test`, Linux) decodes
  it and asserts both keys.
- The parity golden is byte-identical (the new reads live in
  `CrownRotationView`, outside the scan — §3.4 records why that is the
  correct shape here).

**Only a Mac/device can verify (③, next Xcode session):**

- That flipping the binding actually moves Crown *hardware* routing between
  two `digitalCrownRotation` views, and the ~50 ms appearance deferral is
  late enough on-device (it is for `autoFocus`, same mechanism).
- Tap-to-steal focus on a real screen firing `focusChange` on both nodes
  (loser `false`, winner `true`).
- What the system does with the Crown after a resign with no successor claim
  (expected: nothing focused until the user taps; must not crash or spin).
- The demo Crown screen end-to-end (`js/demo/App.tsx` CrownScreen is now the
  two-Crown handoff demo).

The `#if os(watchOS)` guard means the Swift half compiles to an empty module
in `swift test` — the Linux suite proves the *contract*, never the SwiftUI
behavior. Same boundary every interactive feature here has; recorded per the
repo's honesty rule rather than implied.
