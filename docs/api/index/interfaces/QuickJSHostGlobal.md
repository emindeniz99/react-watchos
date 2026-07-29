[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / QuickJSHostGlobal

# Interface: QuickJSHostGlobal

Defined in: [js/src/generated/wire.ts:607](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L607)

Raw globals installed by the host before the bundle is evaluated
 (generated from the schema's direct methods). Strings/numbers cross the C
 boundary; commit/event payloads are JSON strings. `via:"invoke"` methods
 are routed through `invoke`, not installed here.

## Methods

### abortFetch()?

> `optional` **abortFetch**(`id`): `void`

Defined in: [js/src/generated/wire.ts:627](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L627)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### ble()?

> `optional` **ble**(`json`): `void`

Defined in: [js/src/generated/wire.ts:629](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L629)

Fire-and-forget BLE op channel — now only `disconnect`; connect/write/subscribe settle via invoke (bleConnect/bleWrite/bleSubscribe).

#### Parameters

##### json

`string`

#### Returns

`void`

***

### cancelNotification()?

> `optional` **cancelNotification**(`id`): `void`

Defined in: [js/src/generated/wire.ts:625](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L625)

#### Parameters

##### id

`string`

#### Returns

`void`

***

### clearTimer()?

> `optional` **clearTimer**(`id`): `void`

Defined in: [js/src/generated/wire.ts:611](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L611)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### commit()

> **commit**(`treeJson`): `void`

Defined in: [js/src/generated/wire.ts:608](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L608)

#### Parameters

##### treeJson

`string`

#### Returns

`void`

***

### counterAdd()?

> `optional` **counterAdd**(`key`, `delta`, `min`, `max`): `number`

Defined in: [js/src/generated/wire.ts:621](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L621)

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

Defined in: [js/src/generated/wire.ts:620](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L620)

Cross-process-atomic integer counters (ARCH-05): counterAdd does a clamped read-modify-write get/set can't do atomically across processes.

#### Parameters

##### key

`string`

#### Returns

`number`

***

### fetch()?

> `optional` **fetch**(`id`, `requestJson`): `void`

Defined in: [js/src/generated/wire.ts:626](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L626)

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

Defined in: [js/src/generated/wire.ts:631](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L631)

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

Defined in: [js/src/generated/wire.ts:617](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L617)

App Group UserDefaults, shared between app and widget extension.

#### Parameters

##### key

`string`

#### Returns

`string` \| `null`

***

### invoke()?

> `optional` **invoke**(`id`, `method`, `payloadJson`): `void`

Defined in: [js/src/generated/wire.ts:613](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L613)

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

Defined in: [js/src/generated/wire.ts:609](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L609)

#### Parameters

##### message

`string`

#### Returns

`void`

***

### playHaptic()?

> `optional` **playHaptic**(`type`): `void`

Defined in: [js/src/generated/wire.ts:624](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L624)

#### Parameters

##### type

`string`

#### Returns

`void`

***

### publishWidgets()?

> `optional` **publishWidgets**(`payloadJson`): `void`

Defined in: [js/src/generated/wire.ts:615](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L615)

Persists rendered widget timelines and reloads WidgetKit.

#### Parameters

##### payloadJson

`string`

#### Returns

`void`

***

### sensor()?

> `optional` **sensor**(`json`): `void`

Defined in: [js/src/generated/wire.ts:630](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L630)

#### Parameters

##### json

`string`

#### Returns

`void`

***

### setItem()?

> `optional` **setItem**(`key`, `value`): `void`

Defined in: [js/src/generated/wire.ts:618](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L618)

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

Defined in: [js/src/generated/wire.ts:610](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L610)

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

Defined in: [js/src/generated/wire.ts:623](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L623)

Monotonic App-Group state revision (ARCH-06): sampled at widget render start and stamped into the payload so a consumer can prove the timelines derive from current state.

#### Returns

`number`
