[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / generateObject

# Function: generateObject()

> **generateObject**\<`T`\>(`prompt`, `schema`, `options?`): `Promise`\<`T`\>

Defined in: [js/src/ai.ts:587](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L587)

Guided generation: the on-device model fills in `schema` (a typed JSON
Schema subset, [AISchema](../type-aliases/AISchema.md)) and the promise resolves the parsed object.
Constrained decoding natively (`DynamicGenerationSchema`), so the model
cannot produce keys or types outside the schema; a generation that still
can't be decoded — or that the model refuses — rejects with a typed
[AIError](../interfaces/AIError.md) (`DECODING_FAILURE`, `REFUSAL`, …), never garbage.

`T` is a compile-time assertion like `invoke<T>` — the schema is the
runtime contract; keep the two in agreement.

```ts
const plan = await generateObject<{ title: string; minutes: number }>(
  "Suggest one 10-minute mobility exercise",
  {
    type: "object",
    properties: {
      title: { type: "string" },
      minutes: { type: "integer" },
    },
    required: ["title", "minutes"],
  },
);
```

## Type Parameters

### T

`T` = `unknown`

## Parameters

### prompt

`string`

### schema

[`AIObjectSchema`](../interfaces/AIObjectSchema.md)

### options?

[`GenerateObjectOptions`](../type-aliases/GenerateObjectOptions.md)

## Returns

`Promise`\<`T`\>
