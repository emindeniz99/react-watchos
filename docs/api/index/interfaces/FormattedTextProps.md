[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / FormattedTextProps

# Interface: FormattedTextProps

Defined in: [js/src/components.ts:594](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L594)

Locale-aware formatted date/number text, rendered natively (i18n step 2).
QuickJS ships no `Intl` — instead of embedding ICU in the bundle, declare
the value and native formats it with the device locale (the TimerText
"hand native the declarative target" philosophy), so the output always
matches the user's region settings. Set `date` for a date/time or `value`
for a number; `date` wins when both are set.

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

Defined in: [js/src/components.ts:612](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L612)

***

### color?

> `optional` **color?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:614](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L614)

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L104)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### currency?

> `optional` **currency?**: `string`

Defined in: [js/src/components.ts:609](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L609)

ISO 4217 code for `format: "currency"`; absent = the locale's own.

***

### date?

> `optional` **date?**: `number`

Defined in: [js/src/components.ts:596](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L596)

Epoch milliseconds to render as a localized date/time.

***

### dateStyle?

> `optional` **dateStyle?**: `"full"` \| `"none"` \| `"short"` \| `"medium"` \| `"long"`

Defined in: [js/src/components.ts:601](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L601)

Date part style. Default: "medium" for a bare `date`; "none" once
`timeStyle` is set (so a time-only render has no surprise date prefix).

***

### format?

> `optional` **format?**: `"currency"` \| `"decimal"` \| `"percent"`

Defined in: [js/src/components.ts:607](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L607)

Number shape: "percent" renders 0.5 as "50%" (the Intl convention).

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

### maxFractionDigits?

> `optional` **maxFractionDigits?**: `number`

Defined in: [js/src/components.ts:611](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L611)

***

### minFractionDigits?

> `optional` **minFractionDigits?**: `number`

Defined in: [js/src/components.ts:610](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L610)

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

Defined in: [js/src/components.ts:613](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L613)

***

### timeStyle?

> `optional` **timeStyle?**: `"full"` \| `"none"` \| `"short"` \| `"medium"` \| `"long"`

Defined in: [js/src/components.ts:603](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L603)

Time part style (default "none").

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:108](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L108)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`

***

### value?

> `optional` **value?**: `number`

Defined in: [js/src/components.ts:605](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L605)

Number to render with the device locale's separators.
