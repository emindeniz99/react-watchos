[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AI\_TOOL\_CALL\_EVENT

# Variable: AI\_TOOL\_CALL\_EVENT

> `const` **AI\_TOOL\_CALL\_EVENT**: `"ai.toolCall"` = `"ai.toolCall"`

Defined in: [js/src/ai.ts:483](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L483)

Tool-call requests ride the native-event channel under this name, payload
 `{id, callId, tool, argumentsJson}` — edge-triggered, so never replayed
 (replaying one would run a tool the model never asked for).
