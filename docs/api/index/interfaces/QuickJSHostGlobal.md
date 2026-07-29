[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / QuickJSHostGlobal

# Interface: QuickJSHostGlobal

Defined in: [js/src/generated/wire.ts:439](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L439)

Raw globals installed by the host before the bundle is evaluated
 (generated from the schema's direct methods). Strings/numbers cross the C
 boundary; commit/event payloads are JSON strings. `via:"invoke"` methods
 are routed through `invoke`, not installed here.

## Methods

### abortFetch()?

> `optional` **abortFetch**(`id`): `void`

Defined in: [js/src/generated/wire.ts:459](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L459)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### ble()?

> `optional` **ble**(`json`): `void`

Defined in: [js/src/generated/wire.ts:461](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L461)

Fire-and-forget BLE op channel — now only `disconnect`; connect/write/subscribe settle via invoke (bleConnect/bleWrite/bleSubscribe).

#### Parameters

##### json

`string`

#### Returns

`void`

***

### cancelNotification()?

> `optional` **cancelNotification**(`id`): `void`

Defined in: [js/src/generated/wire.ts:457](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L457)

#### Parameters

##### id

`string`

#### Returns

`void`

***

### clearTimer()?

> `optional` **clearTimer**(`id`): `void`

Defined in: [js/src/generated/wire.ts:443](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L443)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### commit()

> **commit**(`treeJson`): `void`

Defined in: [js/src/generated/wire.ts:440](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L440)

#### Parameters

##### treeJson

`string`

#### Returns

`void`

***

### counterAdd()?

> `optional` **counterAdd**(`key`, `delta`, `min`, `max`): `number`

Defined in: [js/src/generated/wire.ts:453](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L453)

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

Defined in: [js/src/generated/wire.ts:452](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L452)

Cross-process-atomic integer counters (ARCH-05): counterAdd does a clamped read-modify-write get/set can't do atomically across processes.

#### Parameters

##### key

`string`

#### Returns

`number`

***

### fetch()?

> `optional` **fetch**(`id`, `requestJson`): `void`

Defined in: [js/src/generated/wire.ts:458](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L458)

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

Defined in: [js/src/generated/wire.ts:463](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L463)

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

Defined in: [js/src/generated/wire.ts:449](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L449)

App Group UserDefaults, shared between app and widget extension.

#### Parameters

##### key

`string`

#### Returns

`string` \| `null`

***

### invoke()?

> `optional` **invoke**(`id`, `method`, `payloadJson`): `void`

Defined in: [js/src/generated/wire.ts:445](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L445)

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

Defined in: [js/src/generated/wire.ts:441](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L441)

#### Parameters

##### message

`string`

#### Returns

`void`

***

### playHaptic()?

> `optional` **playHaptic**(`type`): `void`

Defined in: [js/src/generated/wire.ts:456](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L456)

#### Parameters

##### type

`string`

#### Returns

`void`

***

### publishWidgets()?

> `optional` **publishWidgets**(`payloadJson`): `void`

Defined in: [js/src/generated/wire.ts:447](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L447)

Persists rendered widget timelines and reloads WidgetKit.

#### Parameters

##### payloadJson

`string`

#### Returns

`void`

***

### sensor()?

> `optional` **sensor**(`json`): `void`

Defined in: [js/src/generated/wire.ts:462](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L462)

#### Parameters

##### json

`string`

#### Returns

`void`

***

### setItem()?

> `optional` **setItem**(`key`, `value`): `void`

Defined in: [js/src/generated/wire.ts:450](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L450)

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

Defined in: [js/src/generated/wire.ts:442](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L442)

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

Defined in: [js/src/generated/wire.ts:455](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/generated/wire.ts#L455)

Monotonic App-Group state revision (ARCH-06): sampled at widget render start and stamped into the payload so a consumer can prove the timelines derive from current state.

#### Returns

`number`
