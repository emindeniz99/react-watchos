[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / getAIAvailability

# Function: getAIAvailability()

> **getAIAvailability**(): `Promise`\<[`AIAvailability`](../type-aliases/AIAvailability.md)\>

Defined in: [js/src/ai.ts:630](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L630)

Whether the AI model can serve this watch right now, and if not, why
(CX-002) — a runtime check, distinct from whether the build exposes the
`ai` capability. Use it to show/hide an AI feature without making a
throwaway [generateText](generateText.md) call. Never rejects: anything that keeps the
host from answering resolves `unsupported`.

```ts
const ai = await getAIAvailability();
if (ai === "available") showSummaryButton();
```

## Returns

`Promise`\<[`AIAvailability`](../type-aliases/AIAvailability.md)\>
