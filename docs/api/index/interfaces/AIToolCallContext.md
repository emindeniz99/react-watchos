[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AIToolCallContext

# Interface: AIToolCallContext

Defined in: [js/src/ai.ts:114](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L114)

The context handed to an [AITool](AITool.md) handler alongside its arguments.

## Properties

### signal

> **signal**: [`AbortSignalLike`](AbortSignalLike.md)

Defined in: [js/src/ai.ts:126](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L126)

Aborted when the generation this call belongs to settles — the caller's
abort, the inactivity watchdog, or a native failure. A handler doing its
own async work (a fetch, a long computation) should observe it so a
cancelled generation cancels its pending tool work too, the same contract
the generation itself has with [GenerateOptions.signal](GenerateOptions.md#signal).

***

### toolCallId

> **toolCallId**: `number`

Defined in: [js/src/ai.ts:118](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L118)

Native id of this specific call — a generation may invoke tools several
 times (Apple's framework "executes back-to-back tool calls" and may run
 tools concurrently), and each invocation gets its own id.
