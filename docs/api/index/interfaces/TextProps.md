[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TextProps

# Interface: TextProps

Defined in: [js/src/components.ts:188](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L188)

## Extends

- `A11yProps`.`ModifierProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:76](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L76)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:75](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L75)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:121](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L121)

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

> `optional` **background?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:96](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L96)

Fill color behind the content (rounded when cornerRadius is set).

#### Inherited from

`ModifierProps.background`

***

### backgroundGradient?

> `optional` **backgroundGradient?**: `LinearGradientValue`

Defined in: [js/src/components.ts:102](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L102)

Gradient fill behind the content, drawn where `background` would be
(same cornerRadius rounding, same stroke in an accented complication).
Takes precedence over `background` when both are set.

#### Inherited from

`ModifierProps.backgroundGradient`

***

### bold?

> `optional` **bold?**: `boolean`

Defined in: [js/src/components.ts:196](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L196)

***

### children?

> `optional` **children?**: `string` \| `number` \| `bigint` \| `boolean` \| (`string` \| `number`)[] \| `ReactElement`\<`unknown`, `string` \| `JSXElementConstructor`\<`any`\>\> \| `Iterable`\<`ReactNode`, `any`, `any`\> \| `ReactPortal` \| `Promise`\<`AwaitedReactNode`\> \| `null`

Defined in: [js/src/components.ts:195](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L195)

Strings/numbers fold into one label; nested <Text> elements make RICH
text — segments concatenate into a single native Text, each styled
independently (`Bold <Text bold>this</Text>`). Only <Text> children are
meaningful; other elements are ignored by the interpreter.

***

### color?

> `optional` **color?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:212](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L212)

SwiftUI system color name ("green", "secondary") or "#RRGGBB"/"#RRGGBBAA".

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L104)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### fontDesign?

> `optional` **fontDesign?**: `"default"` \| `"serif"` \| `"rounded"` \| `"monospaced"`

Defined in: [js/src/components.ts:221](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L221)

Type family within the system font (SwiftUI `.fontDesign`): `"serif"` is
New York, `"rounded"` SF Rounded, `"monospaced"` SF Mono. Works with
`textStyle`, so Dynamic Type still applies. A nested segment that omits
it inherits the outer Text's design.

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:89](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L89)

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

Defined in: [js/src/components.ts:114](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L114)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### monospacedDigit?

> `optional` **monospacedDigit?**: `boolean`

Defined in: [js/src/components.ts:214](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L214)

Use fixed-width digits for counters/timers to avoid layout jitter.

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:106](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L106)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:87](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L87)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### size?

> `optional` **size?**: `number`

Defined in: [js/src/components.ts:198](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L198)

Fixed point size. Prefer `textStyle` so text scales with Dynamic Type.

***

### textStyle?

> `optional` **textStyle?**: `"largeTitle"` \| `"title"` \| `"title2"` \| `"title3"` \| `"headline"` \| `"body"` \| `"callout"` \| `"subheadline"` \| `"footnote"` \| `"caption"`

Defined in: [js/src/components.ts:200](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L200)

Semantic font that scales with the user's Dynamic Type setting.

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:108](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L108)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
