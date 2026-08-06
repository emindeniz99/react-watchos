[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HostBridge

# Interface: HostBridge

Defined in: [js/src/host.ts:16](https://github.com/emindeniz99/react-watchos/blob/main/js/src/host.ts#L16)

Where committed trees go. Swift provides this via the `__host` global.

## Methods

### commit()

> **commit**(`tree`, `json?`): `void`

Defined in: [js/src/host.ts:22](https://github.com/emindeniz99/react-watchos/blob/main/js/src/host.ts#L22)

`json` is the caller's already-serialized `tree` (the reconciler computes
it for no-op deduplication). The native bridge forwards that string
instead of re-stringifying; object hosts (tests) ignore it and use `tree`.

#### Parameters

##### tree

[`SerializedTree`](SerializedTree.md)

##### json?

`string`

#### Returns

`void`

***

### log()?

> `optional` **log**(`message`): `void`

Defined in: [js/src/host.ts:23](https://github.com/emindeniz99/react-watchos/blob/main/js/src/host.ts#L23)

#### Parameters

##### message

`string`

#### Returns

`void`
