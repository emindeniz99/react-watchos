[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / GenerateObjectOptions

# Type Alias: GenerateObjectOptions

> **GenerateObjectOptions** = `Omit`\<[`GenerateOptions`](../interfaces/GenerateOptions.md), `"onPartial"` \| `"partialIntervalMs"` \| `"tools"`\>

Defined in: [js/src/ai.ts:268](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L268)

Options for [generateObject](../functions/generateObject.md): everything text generation takes minus
 the partial-stream knobs — a structured generation settles once (structured
 streaming is a recorded follow-up in the design note, not half-shipped) —
 and minus `tools` (guided generation with tool calls is likewise a
 recorded follow-up; the native plan rejects the combination).
