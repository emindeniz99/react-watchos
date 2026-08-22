[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / generateText

# Function: generateText()

> **generateText**(`prompt`, `options?`): `Promise`\<`string`\>

Defined in: [js/src/ai.ts:765](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L765)

Generates text with the on-device model. Rejects with an [AIError](../interfaces/AIError.md)
(`UNAVAILABLE` when AI can't run here). Pass [GenerateOptions.onPartial](../interfaces/GenerateOptions.md#onpartial)
to stream cumulative partial text while the same promise still resolves the
complete answer, and [GenerateOptions.signal](../interfaces/GenerateOptions.md#signal) to cancel:

```ts
const text = await generateText("Summarize my day", {
  instructions: "Be terse.",
  onPartial: (soFar) => setPreview(soFar),
  signal: controller.signal,
});
```

## Parameters

### prompt

`string`

### options?

[`GenerateOptions`](../interfaces/GenerateOptions.md)

## Returns

`Promise`\<`string`\>
