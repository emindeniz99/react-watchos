[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ToggleProps

# Interface: ToggleProps

Defined in: [js/src/components.ts:291](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L291)

## Extends

- `A11yProps`.`ModifierProps`

## Properties

### accessibilityHidden?

> `optional` **accessibilityHidden?**: `boolean`

Defined in: [js/src/components.ts:100](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L100)

Hides this node and its whole subtree from VoiceOver (SwiftUI
`.accessibilityHidden(true)`, applied after label and hint, so it wins
over both). For purely decorative nodes such as a large quote mark or a
drop cap, which VoiceOver would otherwise read out as noise. Never set it
on anything interactive, or on a container holding interactive children:
a hidden control cannot be reached with VoiceOver at all.

#### Inherited from

`A11yProps.accessibilityHidden`

***

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:91](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L91)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:90](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L90)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:161](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L161)

Animate this node's committed changes (SwiftUI `.animation(_:value:)`):
any prop or subtree change transitions with the given curve instead of
snapping. `duration` in seconds (omit for the curve's default). App
only — widgets are static snapshots and ignore it.

#### duration?

> `optional` **duration?**: `number`

#### kind

> **kind**: `"spring"` \| `"ease"` \| `"easeIn"` \| `"easeOut"` \| `"linear"`

#### Inherited from

`ModifierProps.animation`

***

### background?

> `optional` **background?**: [`Fill`](../type-aliases/Fill.md)

Defined in: [js/src/components.ts:125](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L125)

Colour or gradient behind the content (rounded when cornerRadius is set):
`background="#1C1B18"` or
`background={{ type: "linearGradient", colors: ["indigo", "black"] }}`.

#### Inherited from

`ModifierProps.background`

***

### containerBackground?

> `optional` **containerBackground?**: [`Fill`](../type-aliases/Fill.md)

Defined in: [js/src/components.ts:135](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L135)

Full-bleed page colour or gradient behind the system chrome (SwiftUI
`.containerBackground(_, for: .tabView)`). Set it on a TabView page, the
direct child of `<TabView>`; elsewhere it has nothing to fill.

**App-only: a no-op in complications and Smart Stack widgets.** The widget
container's background is fixed to clear. Declared in `codegen/schema.ts`
`propDegradations` and listed in `docs/api/capabilities.md`.

#### Inherited from

`ModifierProps.containerBackground`

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:144](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L144)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### fontDesign?

> `optional` **fontDesign?**: `"default"` \| `"serif"` \| `"rounded"` \| `"monospaced"`

Defined in: [js/src/components.ts:142](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L142)

Type family within the system font (SwiftUI `.fontDesign`): `"serif"` is
New York, `"rounded"` SF Rounded, `"monospaced"` SF Mono. Set on a stack,
it applies to every Text inside; a Text (or nested segment) that sets its
own wins. Works with `textStyle`, so Dynamic Type still applies.

#### Inherited from

`ModifierProps.fontDesign`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:114](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L114)

Fixed and/or max dimensions; `"infinity"` = SwiftUI's fill idiom.

#### height?

> `optional` **height?**: `number`

#### maxHeight?

> `optional` **maxHeight?**: `number` \| `"infinity"`

#### maxWidth?

> `optional` **maxWidth?**: `number` \| `"infinity"`

#### width?

> `optional` **width?**: `number`

#### Inherited from

`ModifierProps.frame`

***

### ignoresSafeArea?

> `optional` **ignoresSafeArea?**: `boolean`

Defined in: [js/src/components.ts:154](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L154)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### label?

> `optional` **label?**: `string`

Defined in: [js/src/components.ts:294](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L294)

***

### onChange?

> `optional` **onChange?**: (`value`) => `void`

Defined in: [js/src/components.ts:293](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L293)

#### Parameters

##### value

`boolean`

#### Returns

`void`

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:146](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L146)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:112](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L112)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:148](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L148)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`

***

### value?

> `optional` **value?**: `boolean`

Defined in: [js/src/components.ts:292](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L292)
