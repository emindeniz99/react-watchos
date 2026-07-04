[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TimerTextProps

# Interface: TimerTextProps

Defined in: [js/src/components.ts:365](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L365)

A self-ticking time label. React renders this ONCE with a start/end
timestamp and SwiftUI animates the digits natively (Text(timerInterval:)),
so a stopwatch/countdown costs zero per-frame JS. For a paused/stopped
value, render a plain <Text> with the frozen string instead.

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

### bold?

> `optional` **bold?**: `boolean`

Defined in: [js/src/components.ts:374](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L374)

***

### color?

> `optional` **color?**: `string`

Defined in: [js/src/components.ts:376](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L376)

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

### milliseconds?

> `optional` **milliseconds?**: `boolean`

Defined in: [js/src/components.ts:373](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L373)

Show mm:ss.SSS using native SwiftUI ticking instead of JS intervals.
 Watch-only: in a widget this degrades to the seconds timer (WidgetKit
 can't live-tick sub-second).

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

### since?

> `optional` **since?**: `number`

Defined in: [js/src/components.ts:367](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L367)

Count up from this epoch-ms start (elapsed time).

***

### size?

> `optional` **size?**: `number`

Defined in: [js/src/components.ts:375](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L375)

***

### tint?

> `optional` **tint?**: `string`

Defined in: [js/src/components.ts:44](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L44)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`

***

### until?

> `optional` **until?**: `number`

Defined in: [js/src/components.ts:369](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L369)

Count down to this epoch-ms deadline. Takes precedence over `since`.
