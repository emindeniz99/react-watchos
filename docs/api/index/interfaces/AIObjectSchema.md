[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AIObjectSchema

# Interface: AIObjectSchema

Defined in: [js/src/ai.ts:310](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L310)

The object node of [AISchema](../type-aliases/AISchema.md) — and the required ROOT of a
 [generateObject](../functions/generateObject.md) call (every surveyed consumer pattern is
 object-rooted, and the root object is the model-visible type).

## Properties

### description?

> `optional` **description?**: `string`

Defined in: [js/src/ai.ts:312](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L312)

***

### properties

> **properties**: `Record`\<`string`, [`AISchema`](../type-aliases/AISchema.md)\>

Defined in: [js/src/ai.ts:315](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L315)

Property order steers guided generation, and is preserved on the wire
 (insertion order of this object).

***

### required?

> `optional` **required?**: readonly `string`[]

Defined in: [js/src/ai.ts:317](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L317)

JSON Schema polarity: a property is OPTIONAL unless listed here.

***

### type

> **type**: `"object"`

Defined in: [js/src/ai.ts:311](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L311)
