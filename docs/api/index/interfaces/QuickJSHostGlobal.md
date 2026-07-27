[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / QuickJSHostGlobal

# Interface: QuickJSHostGlobal

Defined in: [js/src/generated/wire.ts:92](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L92)

Raw globals installed by the host before the bundle is evaluated
 (generated from the schema's direct methods). Strings/numbers cross the C
 boundary; commit/event payloads are JSON strings. `via:"invoke"` methods
 are routed through `invoke`, not installed here.

## Methods

### abortFetch()?

> `optional` **abortFetch**(`id`): `void`

Defined in: [js/src/generated/wire.ts:112](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L112)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### ble()?

> `optional` **ble**(`json`): `void`

Defined in: [js/src/generated/wire.ts:114](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L114)

Fire-and-forget BLE op channel — now only `disconnect`; connect/write/subscribe settle via invoke (bleConnect/bleWrite/bleSubscribe).

#### Parameters

##### json

`string`

#### Returns

`void`

***

### cancelNotification()?

> `optional` **cancelNotification**(`id`): `void`

Defined in: [js/src/generated/wire.ts:110](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L110)

#### Parameters

##### id

`string`

#### Returns

`void`

***

### clearTimer()?

> `optional` **clearTimer**(`id`): `void`

Defined in: [js/src/generated/wire.ts:96](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L96)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### commit()

> **commit**(`treeJson`): `void`

Defined in: [js/src/generated/wire.ts:93](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L93)

#### Parameters

##### treeJson

`string`

#### Returns

`void`

***

### counterAdd()?

> `optional` **counterAdd**(`key`, `delta`, `min`, `max`): `number`

Defined in: [js/src/generated/wire.ts:106](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L106)

#### Parameters

##### key

`string`

##### delta

`number`

##### min

`number`

##### max

`number`

#### Returns

`number`

***

### counterGet()?

> `optional` **counterGet**(`key`): `number`

Defined in: [js/src/generated/wire.ts:105](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L105)

Cross-process-atomic integer counters (ARCH-05): counterAdd does a clamped read-modify-write get/set can't do atomically across processes.

#### Parameters

##### key

`string`

#### Returns

`number`

***

### fetch()?

> `optional` **fetch**(`id`, `requestJson`): `void`

Defined in: [js/src/generated/wire.ts:111](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L111)

#### Parameters

##### id

`number`

##### requestJson

`string`

#### Returns

`void`

***

### generate()?

> `optional` **generate**(`id`, `requestJson`): `void`

Defined in: [js/src/generated/wire.ts:116](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L116)

#### Parameters

##### id

`number`

##### requestJson

`string`

#### Returns

`void`

***

### getItem()?

> `optional` **getItem**(`key`): `string` \| `null`

Defined in: [js/src/generated/wire.ts:102](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L102)

App Group UserDefaults, shared between app and widget extension.

#### Parameters

##### key

`string`

#### Returns

`string` \| `null`

***

### invoke()?

> `optional` **invoke**(`id`, `method`, `payloadJson`): `void`

Defined in: [js/src/generated/wire.ts:98](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L98)

Generic request/response channel for fallible ops (SD-1); settles via __resolveInvoke(id, resultJson) / __rejectInvoke(id, errorJson).

#### Parameters

##### id

`number`

##### method

`string`

##### payloadJson

`string`

#### Returns

`void`

***

### log()

> **log**(`message`): `void`

Defined in: [js/src/generated/wire.ts:94](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L94)

#### Parameters

##### message

`string`

#### Returns

`void`

***

### playHaptic()?

> `optional` **playHaptic**(`type`): `void`

Defined in: [js/src/generated/wire.ts:109](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L109)

#### Parameters

##### type

`string`

#### Returns

`void`

***

### publishWidgets()?

> `optional` **publishWidgets**(`payloadJson`): `void`

Defined in: [js/src/generated/wire.ts:100](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L100)

Persists rendered widget timelines and reloads WidgetKit.

#### Parameters

##### payloadJson

`string`

#### Returns

`void`

***

### sensor()?

> `optional` **sensor**(`json`): `void`

Defined in: [js/src/generated/wire.ts:115](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L115)

#### Parameters

##### json

`string`

#### Returns

`void`

***

### setItem()?

> `optional` **setItem**(`key`, `value`): `void`

Defined in: [js/src/generated/wire.ts:103](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L103)

#### Parameters

##### key

`string`

##### value

`string`

#### Returns

`void`

***

### setTimer()

> **setTimer**(`id`, `ms`): `void`

Defined in: [js/src/generated/wire.ts:95](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L95)

#### Parameters

##### id

`number`

##### ms

`number`

#### Returns

`void`

***

### stateRevision()?

> `optional` **stateRevision**(): `number`

Defined in: [js/src/generated/wire.ts:108](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L108)

Monotonic App-Group state revision (ARCH-06): sampled at widget render start and stamped into the payload so a consumer can prove the timelines derive from current state.

#### Returns

`number`
