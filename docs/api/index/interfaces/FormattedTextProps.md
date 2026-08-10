[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / FormattedTextProps

# Interface: FormattedTextProps

Defined in: [js/src/components.ts:525](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L525)

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

Defined in: [js/src/components.ts:53](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L53)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:52](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L52)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:92](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L92)

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

Defined in: [js/src/components.ts:73](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L73)

Fill color behind the content (rounded when cornerRadius is set).

#### Inherited from

`ModifierProps.background`

***

### bold?

> `optional` **bold?**: `boolean`

Defined in: [js/src/components.ts:543](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L543)

***

### color?

> `optional` **color?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:545](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L545)

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:75](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L75)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### currency?

> `optional` **currency?**: `string`

Defined in: [js/src/components.ts:540](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L540)

ISO 4217 code for `format: "currency"`; absent = the locale's own.

***

### date?

> `optional` **date?**: `number`

Defined in: [js/src/components.ts:527](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L527)

Epoch milliseconds to render as a localized date/time.

***

### dateStyle?

> `optional` **dateStyle?**: `"full"` \| `"none"` \| `"short"` \| `"medium"` \| `"long"`

Defined in: [js/src/components.ts:532](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L532)

Date part style. Default: "medium" for a bare `date`; "none" once
`timeStyle` is set (so a time-only render has no surprise date prefix).

***

### format?

> `optional` **format?**: `"currency"` \| `"decimal"` \| `"percent"`

Defined in: [js/src/components.ts:538](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L538)

Number shape: "percent" renders 0.5 as "50%" (the Intl convention).

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:66](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L66)

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

Defined in: [js/src/components.ts:85](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L85)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### maxFractionDigits?

> `optional` **maxFractionDigits?**: `number`

Defined in: [js/src/components.ts:542](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L542)

***

### minFractionDigits?

> `optional` **minFractionDigits?**: `number`

Defined in: [js/src/components.ts:541](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L541)

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:77](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L77)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:64](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L64)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### size?

> `optional` **size?**: `number`

Defined in: [js/src/components.ts:544](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L544)

***

### timeStyle?

> `optional` **timeStyle?**: `"full"` \| `"none"` \| `"short"` \| `"medium"` \| `"long"`

Defined in: [js/src/components.ts:534](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L534)

Time part style (default "none").

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:79](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L79)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`

***

### value?

> `optional` **value?**: `number`

Defined in: [js/src/components.ts:536](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L536)

Number to render with the device locale's separators.
