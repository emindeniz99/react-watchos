[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AISchema

# Type Alias: AISchema

> **AISchema** = \{ `description?`: `string`; `enum?`: readonly `string`[]; `type`: `"string"`; \} \| \{ `description?`: `string`; `type`: `"number"` \| `"integer"`; \} \| \{ `description?`: `string`; `type`: `"boolean"`; \} \| \{ `description?`: `string`; `items`: `AISchema`; `maxItems?`: `number`; `minItems?`: `number`; `type`: `"array"`; \} \| [`AIObjectSchema`](../interfaces/AIObjectSchema.md)

Defined in: [js/src/ai.ts:171](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L171)

A [generateObject](../functions/generateObject.md) schema — a closed, typed SUBSET of JSON Schema.

JSON Schema's field vocabulary on purpose (`type`/`properties`/`required`/
`items`/`enum`/`minItems`/`maxItems`/`description`): it is what every
surveyed structured-output API takes (Vercel AI SDK, OpenAI structured
outputs), so schemas emitted by existing tools subset straight in. Closed
on purpose too — full JSON Schema (`@types/json-schema`'s JSONSchema7)
admits keywords Apple's `DynamicGenerationSchema` cannot express (`$ref`,
`oneOf`, `patternProperties`, formats…), so typing this parameter as
JSONSchema7 would let schemas compile that the wire must reject at runtime.
The closed union makes an unsupported keyword a COMPILE error instead
(the SensorKind lesson). Everything here maps 1:1 onto a
`DynamicGenerationSchema` construct; what was cut and why is recorded in
the design note.

## Union Members

### Type Literal

\{ `description?`: `string`; `enum?`: readonly `string`[]; `type`: `"string"`; \}

#### description?

> `optional` **description?**: `string`

#### enum?

> `optional` **enum?**: readonly `string`[]

Constrains generation to these choices (`GenerationGuide.anyOf`).

#### type

> **type**: `"string"`

***

### Type Literal

\{ `description?`: `string`; `type`: `"number"` \| `"integer"`; \}

***

### Type Literal

\{ `description?`: `string`; `type`: `"boolean"`; \}

***

### Type Literal

\{ `description?`: `string`; `items`: `AISchema`; `maxItems?`: `number`; `minItems?`: `number`; `type`: `"array"`; \}

***

[`AIObjectSchema`](../interfaces/AIObjectSchema.md)
