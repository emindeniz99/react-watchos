[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / Storage

# Variable: Storage

> `const` **Storage**: `object`

Defined in: [js/src/storage.ts:32](https://github.com/emindeniz99/react-watchos/blob/main/js/src/storage.ts#L32)

## Type Declaration

### clearMemoryFallback()

> **clearMemoryFallback**(): `void`

Test helper: clears the in-memory fallback only.

#### Returns

`void`

### counterAdd()

> **counterAdd**(`key`, `delta`, `min`, `max`): `number`

Atomically add `delta` to a counter, clamp the result to [min, max], persist
it, and return the new value. Cross-process safe on the watch (a file-
coordination claim wraps the whole RMW). Reset-to-floor is a large negative
delta. `writeCount` bumps so the intent runtime's dirty-tracking reloads
widgets, exactly like setItem.

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

### counterValue()

> **counterValue**(`key`): `number`

Current value of a cross-process-atomic counter (ARCH-05), 0 when unset.
Counters live in a separate, file-backed namespace from get/set so that
`counterAdd` can do an atomic read-modify-write the app and the widget
extension can share. Use these — not get/set — for any number two processes
increment.

#### Parameters

##### key

`string`

#### Returns

`number`

### get()

> **get**\<`T`\>(`key`): `T` \| `null`

#### Type Parameters

##### T

`T`

#### Parameters

##### key

`string`

#### Returns

`T` \| `null`

### getString()

> **getString**(`key`): `string` \| `null`

#### Parameters

##### key

`string`

#### Returns

`string` \| `null`

### set()

> **set**(`key`, `value`): `void`

#### Parameters

##### key

`string`

##### value

`unknown`

#### Returns

`void`

### setString()

> **setString**(`key`, `value`): `void`

#### Parameters

##### key

`string`

##### value

`string`

#### Returns

`void`
