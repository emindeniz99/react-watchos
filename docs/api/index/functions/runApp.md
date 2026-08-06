[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / runApp

# Function: runApp()

> **runApp**(`element`, `host?`): [`WatchRoot`](../classes/WatchRoot.md)

Defined in: [js/src/index.ts:448](https://github.com/emindeniz99/react-watchos/blob/main/js/src/index.ts#L448)

Mounts the app. With an explicit host (tests), trees are delivered as
objects. Without one (on the watch), the `__host` global installed by
JSRuntime.swift receives JSON strings, and `__dispatchEvent` is exposed
for Swift to deliver interactions.

One root at a time: call `root.dispose()` before mounting another — it
unmounts the tree (running every effect cleanup) and uninstalls the four
globals below. On the watch a reload never needs it (`boot()` builds a whole
new QuickJS context, so every global and every module binding resets by
construction); in tests it is what keeps sequential mounts from leaking into
each other.

## Parameters

### element

`ReactNode`

### host?

[`HostBridge`](../interfaces/HostBridge.md)

## Returns

[`WatchRoot`](../classes/WatchRoot.md)
