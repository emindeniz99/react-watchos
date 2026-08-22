[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / QuickJSHostGlobal

# Interface: QuickJSHostGlobal

Defined in: [js/src/generated/wire.ts:668](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L668)

Raw globals installed by the host before the bundle is evaluated
 (generated from the schema's direct methods). Strings/numbers cross the C
 boundary; commit/event payloads are JSON strings. `via:"invoke"` methods
 are routed through `invoke`, not installed here.

## Methods

### abortFetch()?

> `optional` **abortFetch**(`id`): `void`

Defined in: [js/src/generated/wire.ts:688](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L688)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### ble()?

> `optional` **ble**(`json`): `void`

Defined in: [js/src/generated/wire.ts:690](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L690)

Fire-and-forget BLE op channel — now only `disconnect`; connect/write/subscribe settle via invoke (bleConnect/bleWrite/bleSubscribe).

#### Parameters

##### json

`string`

#### Returns

`void`

***

### cancelGenerate()?

> `optional` **cancelGenerate**(`id`): `void`

Defined in: [js/src/generated/wire.ts:693](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L693)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### cancelNotification()?

> `optional` **cancelNotification**(`id`): `void`

Defined in: [js/src/generated/wire.ts:686](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L686)

#### Parameters

##### id

`string`

#### Returns

`void`

***

### clearTimer()?

> `optional` **clearTimer**(`id`): `void`

Defined in: [js/src/generated/wire.ts:672](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L672)

#### Parameters

##### id

`number`

#### Returns

`void`

***

### commit()

> **commit**(`treeJson`): `void`

Defined in: [js/src/generated/wire.ts:669](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L669)

#### Parameters

##### treeJson

`string`

#### Returns

`void`

***

### counterAdd()?

> `optional` **counterAdd**(`key`, `delta`, `min`, `max`): `number`

Defined in: [js/src/generated/wire.ts:682](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L682)

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

Defined in: [js/src/generated/wire.ts:681](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L681)

Cross-process-atomic integer counters (ARCH-05): counterAdd does a clamped read-modify-write get/set can't do atomically across processes.

#### Parameters

##### key

`string`

#### Returns

`number`

***

### fetch()?

> `optional` **fetch**(`id`, `requestJson`): `void`

Defined in: [js/src/generated/wire.ts:687](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L687)

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

Defined in: [js/src/generated/wire.ts:692](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L692)

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

Defined in: [js/src/generated/wire.ts:678](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L678)

App Group UserDefaults, shared between app and widget extension.

#### Parameters

##### key

`string`

#### Returns

`string` \| `null`

***

### invoke()?

> `optional` **invoke**(`id`, `method`, `payloadJson`): `void`

Defined in: [js/src/generated/wire.ts:674](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L674)

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

Defined in: [js/src/generated/wire.ts:670](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L670)

#### Parameters

##### message

`string`

#### Returns

`void`

***

### playHaptic()?

> `optional` **playHaptic**(`type`): `void`

Defined in: [js/src/generated/wire.ts:685](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L685)

#### Parameters

##### type

`string`

#### Returns

`void`

***

### publishWidgets()?

> `optional` **publishWidgets**(`payloadJson`): `void`

Defined in: [js/src/generated/wire.ts:676](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L676)

Persists rendered widget timelines and reloads WidgetKit.

#### Parameters

##### payloadJson

`string`

#### Returns

`void`

***

### sensor()?

> `optional` **sensor**(`json`): `void`

Defined in: [js/src/generated/wire.ts:691](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L691)

#### Parameters

##### json

`string`

#### Returns

`void`

***

### setItem()?

> `optional` **setItem**(`key`, `value`): `void`

Defined in: [js/src/generated/wire.ts:679](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L679)

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

Defined in: [js/src/generated/wire.ts:671](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L671)

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

Defined in: [js/src/generated/wire.ts:684](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L684)

Monotonic App-Group state revision (ARCH-06): sampled at widget render start and stamped into the payload so a consumer can prove the timelines derive from current state.

#### Returns

`number`

***

### toolResult()?

> `optional` **toolResult**(`id`, `callId`, `replyJson`): `void`

Defined in: [js/src/generated/wire.ts:694](https://github.com/emindeniz99/react-watchos/blob/main/js/src/generated/wire.ts#L694)

#### Parameters

##### id

`number`

##### callId

`number`

##### replyJson

`string`

#### Returns

`void`
