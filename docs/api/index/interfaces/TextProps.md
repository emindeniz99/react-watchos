[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TextProps

# Interface: TextProps

Defined in: [js/src/components.ts:218](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L218)

## Extends

- `A11yProps`.`ModifierProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:90](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L90)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:89](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L89)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:151](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L151)

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

Defined in: [js/src/components.ts:115](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L115)

Colour or gradient behind the content (rounded when cornerRadius is set):
`background="#1C1B18"` or
`background={{ type: "linearGradient", colors: ["indigo", "black"] }}`.

#### Inherited from

`ModifierProps.background`

***

### bold?

> `optional` **bold?**: `boolean`

Defined in: [js/src/components.ts:226](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L226)

***

### children?

> `optional` **children?**: `string` \| `number` \| `bigint` \| `boolean` \| (`string` \| `number`)[] \| `ReactElement`\<`unknown`, `string` \| `JSXElementConstructor`\<`any`\>\> \| `Iterable`\<`ReactNode`, `any`, `any`\> \| `ReactPortal` \| `Promise`\<`AwaitedReactNode`\> \| `null`

Defined in: [js/src/components.ts:225](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L225)

Strings/numbers fold into one label; nested <Text> elements make RICH
text — segments concatenate into a single native Text, each styled
independently (`Bold <Text bold>this</Text>`). Only <Text> children are
meaningful; other elements are ignored by the interpreter.

***

### color?

> `optional` **color?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:242](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L242)

SwiftUI system color name ("green", "secondary") or "#RRGGBB"/"#RRGGBBAA".

***

### containerBackground?

> `optional` **containerBackground?**: [`Fill`](../type-aliases/Fill.md)

Defined in: [js/src/components.ts:125](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L125)

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

Defined in: [js/src/components.ts:134](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L134)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### fontDesign?

> `optional` **fontDesign?**: `"default"` \| `"serif"` \| `"rounded"` \| `"monospaced"`

Defined in: [js/src/components.ts:132](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L132)

Type family within the system font (SwiftUI `.fontDesign`): `"serif"` is
New York, `"rounded"` SF Rounded, `"monospaced"` SF Mono. Set on a stack,
it applies to every Text inside; a Text (or nested segment) that sets its
own wins. Works with `textStyle`, so Dynamic Type still applies.

#### Inherited from

`ModifierProps.fontDesign`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L104)

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

Defined in: [js/src/components.ts:144](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L144)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### monospacedDigit?

> `optional` **monospacedDigit?**: `boolean`

Defined in: [js/src/components.ts:244](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L244)

Use fixed-width digits for counters/timers to avoid layout jitter.

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:136](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L136)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:102](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L102)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### size?

> `optional` **size?**: `number`

Defined in: [js/src/components.ts:228](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L228)

Fixed point size. Prefer `textStyle` so text scales with Dynamic Type.

***

### textStyle?

> `optional` **textStyle?**: `"largeTitle"` \| `"title"` \| `"title2"` \| `"title3"` \| `"headline"` \| `"body"` \| `"callout"` \| `"subheadline"` \| `"footnote"` \| `"caption"`

Defined in: [js/src/components.ts:230](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L230)

Semantic font that scales with the user's Dynamic Type setting.

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:138](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L138)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
