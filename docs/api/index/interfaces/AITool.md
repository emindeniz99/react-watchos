[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AITool

# Interface: AITool

Defined in: [js/src/ai.ts:157](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L157)

One tool the model may invoke mid-generation
([GenerateOptions.tools](GenerateOptions.md#tools)). The tool's NAME is its key in the `tools`
record (the Vercel AI SDK shape — a record can't declare duplicate names,
where an array could).

## Properties

### description?

> `optional` **description?**: `string`

Defined in: [js/src/ai.ts:160](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L160)

What the tool does and when to use it — the model reads this (Apple puts
 name + description + parameters into the prompt).

***

### execute

> **execute**: (`args`, `context`) => `unknown`

Defined in: [js/src/ai.ts:176](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L176)

Runs the tool. May be async; may throw/reject (the generation then rejects
`TOOL_FAILED` with the message). Return any JSON-serializable value — the
model reads it and continues generating. `args` matches `parameters` by
constrained decoding, the `invoke<T>` compact: the schema is the runtime
contract, so cast to your own type in agreement with it.

#### Parameters

##### args

`Record`\<`string`, `unknown`\>

##### context

[`AIToolCallContext`](AIToolCallContext.md)

#### Returns

`unknown`

***

### parameters

> **parameters**: [`AIObjectSchema`](AIObjectSchema.md)

Defined in: [js/src/ai.ts:168](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L168)

Argument schema, the SAME closed subset [generateObject](../functions/generateObject.md) takes
(object-rooted [AISchema](../type-aliases/AISchema.md)) — natively a `GenerationSchema`, exactly
like a structured output's, so the model's arguments always decode as this
shape. `parameters` is the word Apple's `Tool` protocol, OpenAI function
calling and Vercel (v4) all use.
