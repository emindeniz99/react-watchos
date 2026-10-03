[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / FormattedTextProps

# Interface: FormattedTextProps

Defined in: [js/src/components.ts:626](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L626)

Locale-aware formatted date/number text, rendered natively (i18n step 2).
QuickJS ships no `Intl` — instead of embedding ICU in the bundle, declare
the value and native formats it with the device locale (the TimerText
"hand native the declarative target" philosophy), so the output always
matches the user's region settings. Set `date` for a date/time or `value`
for a number; `date` wins when both are set.

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

### bold?

> `optional` **bold?**: `boolean`

Defined in: [js/src/components.ts:644](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L644)

***

### color?

> `optional` **color?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:646](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L646)

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

### currency?

> `optional` **currency?**: `string`

Defined in: [js/src/components.ts:641](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L641)

ISO 4217 code for `format: "currency"`; absent = the locale's own.

***

### date?

> `optional` **date?**: `number`

Defined in: [js/src/components.ts:628](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L628)

Epoch milliseconds to render as a localized date/time.

***

### dateStyle?

> `optional` **dateStyle?**: `"full"` \| `"none"` \| `"short"` \| `"medium"` \| `"long"`

Defined in: [js/src/components.ts:633](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L633)

Date part style. Default: "medium" for a bare `date`; "none" once
`timeStyle` is set (so a time-only render has no surprise date prefix).

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

### format?

> `optional` **format?**: `"currency"` \| `"decimal"` \| `"percent"`

Defined in: [js/src/components.ts:639](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L639)

Number shape: "percent" renders 0.5 as "50%" (the Intl convention).

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

### maxFractionDigits?

> `optional` **maxFractionDigits?**: `number`

Defined in: [js/src/components.ts:643](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L643)

***

### minFractionDigits?

> `optional` **minFractionDigits?**: `number`

Defined in: [js/src/components.ts:642](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L642)

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

### size?

> `optional` **size?**: `number`

Defined in: [js/src/components.ts:645](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L645)

***

### timeStyle?

> `optional` **timeStyle?**: `"full"` \| `"none"` \| `"short"` \| `"medium"` \| `"long"`

Defined in: [js/src/components.ts:635](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L635)

Time part style (default "none").

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:148](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L148)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`

***

### value?

> `optional` **value?**: `number`

Defined in: [js/src/components.ts:637](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L637)

Number to render with the device locale's separators.
