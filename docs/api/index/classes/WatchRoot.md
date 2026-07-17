[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WatchRoot

# Class: WatchRoot

Defined in: [js/src/renderer.ts:312](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L312)

## Constructors

### Constructor

> **new WatchRoot**(`host`): `WatchRoot`

Defined in: [js/src/renderer.ts:324](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L324)

#### Parameters

##### host

[`HostBridge`](../interfaces/HostBridge.md)

#### Returns

`WatchRoot`

## Methods

### dispatchEvent()

> **dispatchEvent**(`event`): [`DispatchResult`](../interfaces/DispatchResult.md)

Defined in: [js/src/renderer.ts:435](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L435)

Entry point for native interaction events. `handled` is false for
unknown/stale nodes or events with no handler — but the seq is ALWAYS
acked (CX-010), so an optimistic native control is released/rolled back,
never stranded. The cases that used to strand: no handler (early return
before the ack), and a throwing handler (the ack path was skipped). Both
now ack in a `finally`; a handler's exception still propagates afterwards.

`accepted` (ARCH-09): for `pathChange` it's computed AFTER the flush by
comparing the stack node's now-committed path against the proposal —
which is why a controlled `onPathChange` must fold the path
SYNCHRONOUSLY (setState in the handler is fine; this dispatch flushes it
before comparing). An async fold reads as a decline and native snaps
back. Other events: `accepted` mirrors `handled`.

#### Parameters

##### event

[`WatchEvent`](../interfaces/WatchEvent.md)

#### Returns

[`DispatchResult`](../interfaces/DispatchResult.md)

***

### inspect()

> **inspect**(): `object`

Defined in: [js/src/renderer.ts:416](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L416)

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

Defined in: [js/src/renderer.ts:405](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L405)

#### Parameters

##### element

`ReactNode`

#### Returns

`void`

***

### runSync()

> **runSync**\<`T`\>(`fn`): `T`

Defined in: [js/src/renderer.ts:478](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L478)

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

Defined in: [js/src/renderer.ts:410](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/renderer.ts#L410)

#### Returns

`void`
