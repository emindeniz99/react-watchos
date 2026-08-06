[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / handleIntent

# Function: handleIntent()

> **handleIntent**(`name`, `paramsJson?`): `boolean`

Defined in: [js/src/intents.ts:36](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/intents.ts#L36)

Dispatches an intent and auto-reloads the widgets the Glance way: if the
handler changed persisted state (any `Storage` write), the runtime
re-renders + reloads the timelines so the tap can't silently no-op — the
author never calls `publishWidgets()` and so can't forget to. A handler that
wrote nothing doesn't reload, so a no-op intent never spends the WidgetKit
reload budget; and the single publish here coalesces multiple writes into
one reload per dispatch. Returns false for unknown intents so native can
log, not crash.

## Parameters

### name

`string`

### paramsJson?

`string`

## Returns

`boolean`
