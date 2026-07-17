[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TimerTextProps

# Interface: TimerTextProps

Defined in: [js/src/components.ts:471](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L471)

A self-ticking time label. React renders this ONCE with a start/end
timestamp and SwiftUI animates the digits natively (Text(timerInterval:)),
so a stopwatch/countdown costs zero per-frame JS. For a paused/stopped
value, render a plain <Text> with the frozen string instead.

## Extends

- `A11yProps`.`ModifierProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:53](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L53)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:52](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L52)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:92](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L92)

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

Defined in: [js/src/components.ts:73](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L73)

Fill color behind the content (rounded when cornerRadius is set).

#### Inherited from

`ModifierProps.background`

***

### bold?

> `optional` **bold?**: `boolean`

Defined in: [js/src/components.ts:480](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L480)

***

### color?

> `optional` **color?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:482](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L482)

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:75](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L75)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:66](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L66)

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

Defined in: [js/src/components.ts:85](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L85)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### milliseconds?

> `optional` **milliseconds?**: `boolean`

Defined in: [js/src/components.ts:479](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L479)

Show mm:ss.SSS using native SwiftUI ticking instead of JS intervals.
 Watch-only: in a widget this degrades to the seconds timer (WidgetKit
 can't live-tick sub-second).

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:77](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L77)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:64](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L64)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### since?

> `optional` **since?**: `number`

Defined in: [js/src/components.ts:473](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L473)

Count up from this epoch-ms start (elapsed time).

***

### size?

> `optional` **size?**: `number`

Defined in: [js/src/components.ts:481](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L481)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:79](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L79)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`

***

### until?

> `optional` **until?**: `number`

Defined in: [js/src/components.ts:475](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L475)

Count down to this epoch-ms deadline. Takes precedence over `since`.
