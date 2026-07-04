[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / MemoryHost

# Class: MemoryHost

Defined in: [js/src/host.ts:27](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/host.ts#L27)

In-memory host for tests: records every committed tree.

## Implements

- [`HostBridge`](../interfaces/HostBridge.md)

## Constructors

### Constructor

> **new MemoryHost**(): `MemoryHost`

#### Returns

`MemoryHost`

## Properties

### commits

> **commits**: [`SerializedTree`](../interfaces/SerializedTree.md)[] = `[]`

Defined in: [js/src/host.ts:28](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/host.ts#L28)

## Accessors

### lastCommit

#### Get Signature

> **get** **lastCommit**(): [`SerializedTree`](../interfaces/SerializedTree.md) \| `undefined`

Defined in: [js/src/host.ts:34](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/host.ts#L34)

##### Returns

[`SerializedTree`](../interfaces/SerializedTree.md) \| `undefined`

## Methods

### commit()

> **commit**(`tree`): `void`

Defined in: [js/src/host.ts:30](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/host.ts#L30)

`json` is the caller's already-serialized `tree` (the reconciler computes
it for no-op deduplication). The native bridge forwards that string
instead of re-stringifying; object hosts (tests) ignore it and use `tree`.

#### Parameters

##### tree

[`SerializedTree`](../interfaces/SerializedTree.md)

#### Returns

`void`

#### Implementation of

[`HostBridge`](../interfaces/HostBridge.md).[`commit`](../interfaces/HostBridge.md#commit)
