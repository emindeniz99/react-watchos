[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / IntentHandler

# Type Alias: IntentHandler

> **IntentHandler** = (`params?`) => `void`

Defined in: [js/src/intents.ts:14](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/intents.ts#L14)

App Intent handlers written in React-land. WidgetKit Controls (Control
Center / Action button) run an AppIntent in the widget extension; the
extension evaluates the bundle with `__entrypoint = "intent"` and calls
`__handleIntent(name)`, so the same JS that renders the widgets also
handles the interaction. A handler just mutates `Storage`; the runtime
reloads the widgets for it (see handleIntent) — it must NOT call
`publishWidgets()` itself.

## Parameters

### params?

`Record`\<`string`, `unknown`\>

## Returns

`void`
