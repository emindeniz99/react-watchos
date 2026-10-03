[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TimerTextProps

# Interface: TimerTextProps

Defined in: [js/src/components.ts:572](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L572)

A self-ticking time label. React renders this ONCE with a start/end
timestamp and SwiftUI animates the digits natively (Text(timerInterval:)),
so a stopwatch/countdown costs zero per-frame JS. For a paused/stopped
value, render a plain <Text> with the frozen string instead.

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

Defined in: [js/src/components.ts:581](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L581)

***

### color?

> `optional` **color?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:583](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L583)

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L104)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

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

### milliseconds?

> `optional` **milliseconds?**: `boolean`

Defined in: [js/src/components.ts:580](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L580)

Show mm:ss.SSS using native SwiftUI ticking instead of JS intervals.
 Watch-only: in a widget this degrades to the seconds timer (WidgetKit
 can't live-tick sub-second).

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

### since?

> `optional` **since?**: `number`

Defined in: [js/src/components.ts:574](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L574)

Count up from this epoch-ms start (elapsed time).

***

### size?

> `optional` **size?**: `number`

Defined in: [js/src/components.ts:582](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L582)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:108](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L108)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`

***

### until?

> `optional` **until?**: `number`

Defined in: [js/src/components.ts:576](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L576)

Count down to this epoch-ms deadline. Takes precedence over `since`.
