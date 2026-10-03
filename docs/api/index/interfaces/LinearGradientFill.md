[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / LinearGradientFill

# Interface: LinearGradientFill

Defined in: [js/src/components.ts:63](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L63)

A linear gradient fill (SwiftUI `LinearGradient`) from `start` (default
`"top"`) to `end` (default `"bottom"`). Give exactly one of `colors` or
`stops`, with at least two valid entries; otherwise the node draws no fill.

## Properties

### colors?

> `optional` **colors?**: [`ColorValue`](../type-aliases/ColorValue.md)[]

Defined in: [js/src/components.ts:66](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L66)

Evenly spaced colours; use `stops` instead for explicit positions.

***

### end?

> `optional` **end?**: [`UnitPointName`](../type-aliases/UnitPointName.md)

Defined in: [js/src/components.ts:74](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L74)

***

### start?

> `optional` **start?**: [`UnitPointName`](../type-aliases/UnitPointName.md)

Defined in: [js/src/components.ts:73](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L73)

***

### stops?

> `optional` **stops?**: `object`[]

Defined in: [js/src/components.ts:72](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L72)

Explicit stops: `location` runs 0…1 and must not decrease from one stop
to the next. A stop outside 0…1 or out of order voids the whole fill; a
stop with an unknown colour is dropped.

#### color

> **color**: [`ColorValue`](../type-aliases/ColorValue.md)

#### location

> **location**: `number`

***

### type

> **type**: `"linearGradient"`

Defined in: [js/src/components.ts:64](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L64)
