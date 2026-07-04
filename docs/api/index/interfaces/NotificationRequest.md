[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NotificationRequest

# Interface: NotificationRequest

Defined in: [js/src/notifications.ts:14](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/notifications.ts#L14)

Local notifications scheduled from React, delivered by the watch even
if the app has been suspended. No-ops where the host lacks the bridge
(tests, Node, the widget extension).

## Properties

### afterMs?

> `optional` **afterMs?**: `number`

Defined in: [js/src/notifications.ts:20](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/notifications.ts#L20)

Deliver after this many ms from now...

***

### at?

> `optional` **at?**: `number` \| `Date`

Defined in: [js/src/notifications.ts:22](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/notifications.ts#L22)

...or at an absolute time (ms since epoch or Date). Takes precedence.

***

### body?

> `optional` **body?**: `string`

Defined in: [js/src/notifications.ts:18](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/notifications.ts#L18)

***

### id?

> `optional` **id?**: `string`

Defined in: [js/src/notifications.ts:16](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/notifications.ts#L16)

Stable id for cancel/replace; generated when omitted.

***

### sound?

> `optional` **sound?**: `boolean`

Defined in: [js/src/notifications.ts:24](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/notifications.ts#L24)

Play the default sound (default true).

***

### title

> **title**: `string`

Defined in: [js/src/notifications.ts:17](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/notifications.ts#L17)
