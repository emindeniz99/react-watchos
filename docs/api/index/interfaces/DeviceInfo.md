[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / DeviceInfo

# Interface: DeviceInfo

Defined in: [js/src/device.ts:9](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L9)

Device info (WKInterfaceDevice): a one-shot snapshot of the watch's
hardware/state. watchOS exposes no battery-change *notification* (unlike
iOS) — poll `getDeviceInfo()` when you need a fresh reading, e.g. from a
`scheduleBackgroundRefresh` handler.

## Properties

### batteryLevel

> **batteryLevel**: `number`

Defined in: [js/src/device.ts:11](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L11)

0–1, or -1 when battery monitoring is unavailable.

***

### batteryState

> **batteryState**: `"unknown"` \| `"unplugged"` \| `"charging"` \| `"full"`

Defined in: [js/src/device.ts:12](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L12)

***

### crownOrientation

> **crownOrientation**: `"left"` \| `"right"`

Defined in: [js/src/device.ts:16](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L16)

Crown on the same side as the wrist, or the other side.

***

### is24Hour

> **is24Hour**: `boolean`

Defined in: [js/src/device.ts:38](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L38)

The user's time-format preference (12h vs 24h clock).

***

### language

> **language**: `string`

Defined in: [js/src/device.ts:36](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L36)

***

### layoutDirection

> **layoutDirection**: `"leftToRight"` \| `"rightToLeft"`

Defined in: [js/src/device.ts:20](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L20)

***

### locale

> **locale**: `string`

Defined in: [js/src/device.ts:35](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L35)

i18n foundation (M7). QuickJS ships no `Intl` — `toLocaleString` renders
a hardcoded US-style format — so these host fields are how an app picks a
translation table and formats per user. `locale` is the full identifier
(e.g. "de_DE"), `language` the bare code ("de").

***

### model

> **model**: `string`

Defined in: [js/src/device.ts:21](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L21)

***

### name

> **name**: `string`

Defined in: [js/src/device.ts:23](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L23)

***

### preferredContentSizeCategory

> **preferredContentSizeCategory**: `string`

Defined in: [js/src/device.ts:28](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L28)

Dynamic Type size, e.g. "UICTContentSizeCategoryL".

***

### reduceMotion

> **reduceMotion**: `boolean`

Defined in: [js/src/device.ts:25](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L25)

Accessibility state (poll; watchOS has no change notification here).

***

### screenHeight

> **screenHeight**: `number`

Defined in: [js/src/device.ts:18](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L18)

***

### screenScale

> **screenScale**: `number`

Defined in: [js/src/device.ts:19](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L19)

***

### screenWidth

> **screenWidth**: `number`

Defined in: [js/src/device.ts:17](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L17)

***

### systemVersion

> **systemVersion**: `string`

Defined in: [js/src/device.ts:22](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L22)

***

### voiceOverRunning

> **voiceOverRunning**: `boolean`

Defined in: [js/src/device.ts:26](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L26)

***

### wristLocation

> **wristLocation**: `"left"` \| `"right"`

Defined in: [js/src/device.ts:14](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/device.ts#L14)

Which wrist the watch is on, per the user's settings.
