[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NativeEventHandler

# Type Alias: NativeEventHandler

> **NativeEventHandler** = (`payload?`) => `void`

Defined in: [js/src/nativeEvents.ts:9](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/nativeEvents.ts#L9)

Named listeners for state pushed from native code (connection state,
sensors, incoming messages) — anything that isn't a user interaction.
Native calls `__pushNativeEvent(name, payloadJson)`, which runApp routes
through WatchRoot.runSync so the resulting React update commits
instantly, exactly like a tap, instead of on the scheduler's next turn.

## Parameters

### payload?

`Record`\<`string`, `unknown`\>

## Returns

`void`
