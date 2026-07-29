[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / QuickJSHostGlobal

# Interface: QuickJSHostGlobal

Defined in: [js/src/generated/wire.ts:528](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L528)

Raw globals installed by the host before the bundle is evaluated
 (generated from the schema's direct methods). Strings/numbers cross the C
 boundary; commit/event payloads are JSON strings. `via:"invoke"` methods
 are routed through `invoke`, not installed here.

## Methods

### abortFetch()?

> `optional` **abortFetch**(`id`): `void`

Defined in: [js/src/generated/wire.ts:548](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L548)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### ble()?

> `optional` **ble**(`json`): `void`

Defined in: [js/src/generated/wire.ts:550](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L550)

Fire-and-forget BLE op channel — now only `disconnect`; connect/write/subscribe settle via invoke (bleConnect/bleWrite/bleSubscribe).

#### Parameters

##### json

`string`

#### Returns

`void`

***

### cancelNotification()?

> `optional` **cancelNotification**(`id`): `void`

Defined in: [js/src/generated/wire.ts:546](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L546)

#### Parameters

##### id

`string`

#### Returns

`void`

***

### clearTimer()?

> `optional` **clearTimer**(`id`): `void`

Defined in: [js/src/generated/wire.ts:532](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L532)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### commit()

> **commit**(`treeJson`): `void`

Defined in: [js/src/generated/wire.ts:529](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L529)

#### Parameters

##### treeJson

`string`

#### Returns

`void`

***

### counterAdd()?

> `optional` **counterAdd**(`key`, `delta`, `min`, `max`): `number`

Defined in: [js/src/generated/wire.ts:542](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L542)

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

Defined in: [js/src/generated/wire.ts:541](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L541)

Cross-process-atomic integer counters (ARCH-05): counterAdd does a clamped read-modify-write get/set can't do atomically across processes.

#### Parameters

##### key

`string`

#### Returns

`number`

***

### fetch()?

> `optional` **fetch**(`id`, `requestJson`): `void`

Defined in: [js/src/generated/wire.ts:547](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L547)

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

Defined in: [js/src/generated/wire.ts:552](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L552)

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

Defined in: [js/src/generated/wire.ts:538](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L538)

App Group UserDefaults, shared between app and widget extension.

#### Parameters

##### key

`string`

#### Returns

`string` \| `null`

***

### invoke()?

> `optional` **invoke**(`id`, `method`, `payloadJson`): `void`

Defined in: [js/src/generated/wire.ts:534](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L534)

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

Defined in: [js/src/generated/wire.ts:530](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L530)

#### Parameters

##### message

`string`

#### Returns

`void`

***

### playHaptic()?

> `optional` **playHaptic**(`type`): `void`

Defined in: [js/src/generated/wire.ts:545](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L545)

#### Parameters

##### type

`string`

#### Returns

`void`

***

### publishWidgets()?

> `optional` **publishWidgets**(`payloadJson`): `void`

Defined in: [js/src/generated/wire.ts:536](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L536)

Persists rendered widget timelines and reloads WidgetKit.

#### Parameters

##### payloadJson

`string`

#### Returns

`void`

***

### sensor()?

> `optional` **sensor**(`json`): `void`

Defined in: [js/src/generated/wire.ts:551](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L551)

#### Parameters

##### json

`string`

#### Returns

`void`

***

### setItem()?

> `optional` **setItem**(`key`, `value`): `void`

Defined in: [js/src/generated/wire.ts:539](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L539)

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

Defined in: [js/src/generated/wire.ts:531](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L531)

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

Defined in: [js/src/generated/wire.ts:544](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L544)

Monotonic App-Group state revision (ARCH-06): sampled at widget render start and stamped into the payload so a consumer can prove the timelines derive from current state.

#### Returns

`number`
