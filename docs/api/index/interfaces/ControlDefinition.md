[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ControlDefinition

# Interface: ControlDefinition

Defined in: [js/src/widgets.ts:252](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L252)

Metadata for a WidgetKit Control (watchOS 26 Control Center / Action
button). Controls are templated by the OS — a symbol plus a label, not
a free-form view — so React authors the metadata and handles the
control's AppIntent via registerIntent.

## Properties

### actionLabel?

> `optional` **actionLabel?**: `string`

Defined in: [js/src/widgets.ts:263](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L263)

`ControlWidgetButton`'s second label, shown while the action runs
("Adding…" next to a "Add Glass" label). Ignored by a toggle.

***

### intent

> **intent**: `string`

Defined in: [js/src/widgets.ts:256](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L256)

Intent name dispatched back into JS when the control is used.

***

### kind

> **kind**: `string`

Defined in: [js/src/widgets.ts:254](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L254)

WidgetKit control kind, e.g. "hydration.addGlass".

***

### label

> **label**: `string`

Defined in: [js/src/widgets.ts:257](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L257)

***

### systemName?

> `optional` **systemName?**: `string`

Defined in: [js/src/widgets.ts:258](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L258)

***

### value?

> `optional` **value?**: `boolean` \| (() => `boolean`)

Defined in: [js/src/widgets.ts:281](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L281)

Current on/off state for a `ControlWidgetToggle`. **Presence marks this
control a toggle**: a control that publishes no `value` is a button, and
the native `reactControlToggle` returns nil for it rather than letting a
consumer render a toggle whose `isOn` nobody publishes.

Prefer the GETTER form. `registerControl` is called once, but a toggle's
state changes every time the user flips it — a literal `boolean` is
captured at registration and would publish that first value forever, so the
control would draw itself as stuck. A `() => boolean` is called on every
publish, exactly like `WidgetDefinition.render`. A literal stays supported
for genuinely constant state.

This supplies a Swift-declared toggle's STATE; it cannot turn a
`ControlWidgetButton` into a `ControlWidgetToggle` — those are different
types in the consumer's `@main` bundle (see `registerControl`).
