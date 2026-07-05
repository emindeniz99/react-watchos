[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WatchTheme

# Interface: WatchTheme

Defined in: [js/src/theme.ts:32](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/theme.ts#L32)

## Properties

### colors

> **colors**: `object`

Defined in: [js/src/theme.ts:42](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/theme.ts#L42)

Semantic colors (system color names or #RRGGBB[AA] hex — anything the
`color`/`background`/`tint` props accept). Prefer the semantic names so
screens stay consistent when the accent changes.

#### accent

> **accent**: [`ColorValue`](../type-aliases/ColorValue.md)

App accent — buttons, gauges, links.

#### destructive

> **destructive**: [`ColorValue`](../type-aliases/ColorValue.md)

Destructive/error state.

#### muted

> **muted**: [`ColorValue`](../type-aliases/ColorValue.md)

De-emphasized text.

#### positive

> **positive**: [`ColorValue`](../type-aliases/ColorValue.md)

Positive state (goal reached, connected).

#### surface

> **surface**: [`ColorValue`](../type-aliases/ColorValue.md)

Card/section fill behind content.

#### warning

> **warning**: [`ColorValue`](../type-aliases/ColorValue.md)

Warning state (low battery, degraded).

***

### radius

> **radius**: `object`

Defined in: [js/src/theme.ts:36](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/theme.ts#L36)

Corner-radius scale (points).

#### lg

> **lg**: `number`

#### md

> **md**: `number`

#### sm

> **sm**: `number`

***

### space

> **space**: `object`

Defined in: [js/src/theme.ts:34](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/theme.ts#L34)

Spacing scale (points) for spacing/padding.

#### lg

> **lg**: `number`

#### md

> **md**: `number`

#### sm

> **sm**: `number`

#### xl

> **xl**: `number`

#### xs

> **xs**: `number`

***

### text

> **text**: `object`

Defined in: [js/src/theme.ts:57](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/theme.ts#L57)

Text variants — spread onto <Text>: `<Text {...theme.text.title}>`.

#### body

> **body**: [`TextVariant`](../type-aliases/TextVariant.md)

#### caption

> **caption**: [`TextVariant`](../type-aliases/TextVariant.md)

#### headline

> **headline**: [`TextVariant`](../type-aliases/TextVariant.md)

#### muted

> **muted**: [`TextVariant`](../type-aliases/TextVariant.md)

#### numeric

> **numeric**: [`TextVariant`](../type-aliases/TextVariant.md)

Fixed-width digits for counters/timers (no layout jitter).

#### title

> **title**: [`TextVariant`](../type-aliases/TextVariant.md)
