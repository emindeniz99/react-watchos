[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AIError

# Interface: AIError

Defined in: [js/src/ai.ts:52](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L52)

Error thrown by a rejected generation; `code` is machine-switchable.
 An aborted generation additionally carries `name: "AbortError"`, so a
 caller's existing fetch-style `error.name` check works unchanged.

## Extends

- `Error`

## Properties

### code

> **code**: [`AIErrorCode`](../type-aliases/AIErrorCode.md)

Defined in: [js/src/ai.ts:53](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L53)

***

### message

> **message**: `string`

Defined in: [node\_modules/.pnpm/typescript@6.0.3/node\_modules/typescript/lib/lib.es5.d.ts:1075](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/lib.es5.d.ts#L1075)

#### Inherited from

`Error.message`

***

### name

> **name**: `string`

Defined in: [node\_modules/.pnpm/typescript@6.0.3/node\_modules/typescript/lib/lib.es5.d.ts:1074](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/lib.es5.d.ts#L1074)

#### Inherited from

`Error.name`

***

### stack?

> `optional` **stack?**: `string`

Defined in: [node\_modules/.pnpm/typescript@6.0.3/node\_modules/typescript/lib/lib.es5.d.ts:1076](https://github.com/emindeniz99/react-watchos/blob/main/node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/lib.es5.d.ts#L1076)

#### Inherited from

`Error.stack`
