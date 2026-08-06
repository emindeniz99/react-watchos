[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TypedMessages

# Interface: TypedMessages\<T\>

Defined in: [js/src/connectivity.ts:445](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L445)

Typed `send`/`on` over one [MessageContract](../type-aliases/MessageContract.md); see [defineMessages](../functions/defineMessages.md).

## Type Parameters

### T

`T` *extends* [`MessageContract`](../type-aliases/MessageContract.md)

## Methods

### on()

> **on**\<`K`\>(`name`, `handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/connectivity.ts:452](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L452)

Handle a typed message from the phone. Returns an unsubscribe.

#### Type Parameters

##### K

`K` *extends* `string`

#### Parameters

##### name

`K`

##### handler

(`payload`) => `void`

#### Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)

***

### send()

> **send**\<`K`\>(`name`, `payload`): `Promise`\<`Record`\<`string`, `unknown`\>\>

Defined in: [js/src/connectivity.ts:447](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L447)

Send a typed message to the phone; resolves the phone's reply.

#### Type Parameters

##### K

`K` *extends* `string`

#### Parameters

##### name

`K`

##### payload

`T`\[`K`\]

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\>\>
