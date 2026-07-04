[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / GaugeProps

# Interface: GaugeProps

Defined in: [js/src/components.ts:205](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L205)

## Extends

- `A11yProps`.`ModifierProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:18](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L18)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:17](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L17)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:51](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L51)

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

> `optional` **background?**: `string`

Defined in: [js/src/components.ts:38](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L38)

Fill color behind the content (rounded when cornerRadius is set).

#### Inherited from

`ModifierProps.background`

***

### color?

> `optional` **color?**: `string`

Defined in: [js/src/components.ts:212](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L212)

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:40](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L40)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:31](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L31)

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

### label?

> `optional` **label?**: `string`

Defined in: [js/src/components.ts:209](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L209)

***

### max?

> `optional` **max?**: `number`

Defined in: [js/src/components.ts:208](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L208)

***

### min?

> `optional` **min?**: `number`

Defined in: [js/src/components.ts:207](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L207)

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:42](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L42)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:29](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L29)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### style?

> `optional` **style?**: `string`

Defined in: [js/src/components.ts:211](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L211)

"circular" | "linear"; widgets pick accessory styles by family.

***

### tint?

> `optional` **tint?**: `string`

Defined in: [js/src/components.ts:44](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L44)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`

***

### value

> **value**: `number`

Defined in: [js/src/components.ts:206](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L206)
