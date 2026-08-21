[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ControlDefinition

# Interface: ControlDefinition

Defined in: [js/src/widgets.ts:267](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L267)

Metadata for a WidgetKit Control (watchOS 26 Control Center / Action
button). Controls are templated by the OS — a symbol plus a label, not
a free-form view — so React authors the metadata and handles the
control's AppIntent via registerIntent.

## Properties

### actionLabel?

> `optional` **actionLabel?**: `string`

Defined in: [js/src/widgets.ts:278](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L278)

`ControlWidgetButton`'s second label, shown while the action runs
("Adding…" next to a "Add Glass" label). Ignored by a toggle.

***

### intent

> **intent**: `string`

Defined in: [js/src/widgets.ts:271](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L271)

Intent name dispatched back into JS when the control is used.

***

### kind

> **kind**: `string`

Defined in: [js/src/widgets.ts:269](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L269)

WidgetKit control kind, e.g. "hydration.addGlass".

***

### label

> **label**: `string`

Defined in: [js/src/widgets.ts:272](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L272)

***

### systemName?

> `optional` **systemName?**: `string`

Defined in: [js/src/widgets.ts:273](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L273)

***

### value?

> `optional` **value?**: `boolean` \| (() => `boolean`)

Defined in: [js/src/widgets.ts:296](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L296)

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
