[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / runApp

# Function: runApp()

> **runApp**(`element`, `host?`): [`WatchRoot`](../classes/WatchRoot.md)

Defined in: [js/src/index.ts:265](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/index.ts#L265)

Mounts the app. With an explicit host (tests), trees are delivered as
objects. Without one (on the watch), the `__host` global installed by
JSRuntime.swift receives JSON strings, and `__dispatchEvent` is exposed
for Swift to deliver interactions.

## Parameters

### element

`ReactNode`

### host?

[`HostBridge`](../interfaces/HostBridge.md)

## Returns

[`WatchRoot`](../classes/WatchRoot.md)
