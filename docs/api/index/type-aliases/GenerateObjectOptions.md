[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / GenerateObjectOptions

# Type Alias: GenerateObjectOptions

> **GenerateObjectOptions** = `Omit`\<[`GenerateOptions`](../interfaces/GenerateOptions.md), `"onPartial"` \| `"partialIntervalMs"`\>

Defined in: [js/src/ai.ts:150](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L150)

Options for [generateObject](../functions/generateObject.md): everything text generation takes minus
 the partial-stream knobs — a structured generation settles once (structured
 streaming is a recorded follow-up in the design note, not half-shipped).
