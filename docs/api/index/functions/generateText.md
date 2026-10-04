[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / generateText

# Function: generateText()

> **generateText**(`prompt`, `options?`): `Promise`\<`string`\>

Defined in: [js/src/ai.ts:826](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L826)

Generates text with Apple Intelligence (Private Cloud Compute on watchOS —
see the module note). Rejects with an [AIError](../interfaces/AIError.md) (`UNAVAILABLE` when
AI can't run here, `NETWORK_FAILURE` offline, `QUOTA_LIMIT_REACHED` when
the person's daily quota is spent). Pass [GenerateOptions.onPartial](../interfaces/GenerateOptions.md#onpartial)
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
