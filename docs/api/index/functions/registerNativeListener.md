[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / registerNativeListener

# Function: registerNativeListener()

> **registerNativeListener**(`name`, `handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/nativeEvents.ts:40](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/nativeEvents.ts#L40)

Subscribes `handler` to native event `name`. Multiple handlers per event are
supported — each fires. Returns an unsubscribe function; use it as a React
effect's cleanup so unmounting a screen drops its listener (and doesn't
accumulate stale ones on remount):

```ts
useEffect(() => registerNativeListener("ble.state", onState), []);
```

## Parameters

### name

`string`

### handler

[`NativeEventHandler`](../type-aliases/NativeEventHandler.md)

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
