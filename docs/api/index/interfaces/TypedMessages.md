[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TypedMessages

# Interface: TypedMessages\<T\>

Defined in: [js/src/connectivity.ts:400](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L400)

Typed `send`/`on` over one [MessageContract](../type-aliases/MessageContract.md); see [defineMessages](../functions/defineMessages.md).

## Type Parameters

### T

`T` *extends* [`MessageContract`](../type-aliases/MessageContract.md)

## Methods

### on()

> **on**\<`K`\>(`name`, `handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/connectivity.ts:407](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L407)

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

Defined in: [js/src/connectivity.ts:402](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L402)

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
