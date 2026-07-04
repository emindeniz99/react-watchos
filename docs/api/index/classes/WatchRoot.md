[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WatchRoot

# Class: WatchRoot

Defined in: [js/src/renderer.ts:299](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L299)

## Constructors

### Constructor

> **new WatchRoot**(`host`): `WatchRoot`

Defined in: [js/src/renderer.ts:307](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L307)

#### Parameters

##### host

[`HostBridge`](../interfaces/HostBridge.md)

#### Returns

`WatchRoot`

## Methods

### dispatchEvent()

> **dispatchEvent**(`event`): `boolean`

Defined in: [js/src/renderer.ts:418](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L418)

Entry point for native interaction events. Returns false for unknown/stale
nodes or events with no handler — but ALWAYS acks the seq (CX-010), so an
optimistic native control is released/rolled back, never stranded. The
cases that used to strand: no handler (early return before the ack), and a
throwing handler (the ack path was skipped). Both now ack in a `finally`;
a handler's exception still propagates afterwards.

#### Parameters

##### event

[`WatchEvent`](../interfaces/WatchEvent.md)

#### Returns

`boolean`

***

### inspect()

> **inspect**(): `object`

Defined in: [js/src/renderer.ts:406](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L406)

Debug inspector: the current serialized tree + commit count.

#### Returns

`object`

##### commits

> **commits**: `number`

##### tree

> **tree**: [`SerializedTree`](../interfaces/SerializedTree.md)

***

### render()

> **render**(`element`): `void`

Defined in: [js/src/renderer.ts:395](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L395)

#### Parameters

##### element

`ReactNode`

#### Returns

`void`

***

### runSync()

> **runSync**\<`T`\>(`fn`): `T`

Defined in: [js/src/renderer.ts:453](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L453)

Runs `fn` at urgent (discrete) priority and flushes synchronously, so
any state it changes commits before returning — the same path a tap
takes. Native pushes (connection state, sensors, incoming messages)
go through here to react instantly instead of waiting for the
scheduler's next default-priority turn.

#### Type Parameters

##### T

`T`

#### Parameters

##### fn

() => `T`

#### Returns

`T`

***

### unmount()

> **unmount**(): `void`

Defined in: [js/src/renderer.ts:400](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L400)

#### Returns

`void`
