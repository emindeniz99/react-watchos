[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WatchRoot

# Class: WatchRoot

Defined in: [js/src/renderer.ts:312](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/renderer.ts#L312)

## Constructors

### Constructor

> **new WatchRoot**(`host`, `onDispose?`): `WatchRoot`

Defined in: [js/src/renderer.ts:329](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/renderer.ts#L329)

#### Parameters

##### host

[`HostBridge`](../interfaces/HostBridge.md)

##### onDispose?

() => `void`

#### Returns

`WatchRoot`

## Methods

### dispatchEvent()

> **dispatchEvent**(`event`): [`DispatchResult`](../interfaces/DispatchResult.md)

Defined in: [js/src/renderer.ts:490](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/renderer.ts#L490)

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

### dispose()

> **dispose**(): `void`

Defined in: [js/src/renderer.ts:446](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/renderer.ts#L446)

ARCH-08: the deterministic teardown for a root and everything installed
FOR it. In order:
  1. `unmount()`, so React runs every effect cleanup — that's what
     releases the component-owned `registerNativeListener` unsubscribes,
     sensor tokens and timers. A root that is merely abandoned keeps all
     of them, and (worse) keeps receiving `dispatchNativeEvent` fan-out
     into a tree nothing is looking at.
  2. the `onDispose` hook — `runApp` uses it to uninstall its three
     globals, identity-checked (see index.ts).
  3. every later entry throws instead of silently no-op'ing (rule 12).

Deliberately does NOT clear the process-wide `listeners`/`intents`/widget
registries (module-scope `registerIntent`/`registerWidget` calls are made
BEFORE any `runApp`, and the widget/intent entrypoints run in a context
where `runApp` never happens — `unregisterAll*` stay the explicit,
separate reset API), does not touch the Swift-owned `__host*` globals,
does not stop the inspector (a process-level dev tool that spans reloads
by design), and does not reject in-flight invoke/fetch/generate promises
(they are id-correlated to native work that is still running; their
watchdogs bound them, and cancelling native work is `boot()`'s job).

Idempotent: a second call is a no-op.

#### Returns

`void`

***

### inspect()

> **inspect**(): `object`

Defined in: [js/src/renderer.ts:462](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/renderer.ts#L462)

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

Defined in: [js/src/renderer.ts:411](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/renderer.ts#L411)

#### Parameters

##### element

`ReactNode`

#### Returns

`void`

***

### runSync()

> **runSync**\<`T`\>(`fn`): `T`

Defined in: [js/src/renderer.ts:534](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/renderer.ts#L534)

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

Defined in: [js/src/renderer.ts:417](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/renderer.ts#L417)

#### Returns

`void`
