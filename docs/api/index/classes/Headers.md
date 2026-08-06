[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / Headers

# Class: Headers

Defined in: [js/src/fetch.ts:35](https://github.com/emindeniz99/react-watchos/blob/main/js/src/fetch.ts#L35)

HTTP header names are case-insensitive — store and look up lowercased.

## Constructors

### Constructor

> **new Headers**(`init?`): `Headers`

Defined in: [js/src/fetch.ts:38](https://github.com/emindeniz99/react-watchos/blob/main/js/src/fetch.ts#L38)

#### Parameters

##### init?

`HeadersInit`

#### Returns

`Headers`

## Methods

### append()

> **append**(`name`, `value`): `void`

Defined in: [js/src/fetch.ts:59](https://github.com/emindeniz99/react-watchos/blob/main/js/src/fetch.ts#L59)

#### Parameters

##### name

`string`

##### value

`string`

#### Returns

`void`

***

### delete()

> **delete**(`name`): `void`

Defined in: [js/src/fetch.ts:64](https://github.com/emindeniz99/react-watchos/blob/main/js/src/fetch.ts#L64)

#### Parameters

##### name

`string`

#### Returns

`void`

***

### forEach()

> **forEach**(`cb`): `void`

Defined in: [js/src/fetch.ts:67](https://github.com/emindeniz99/react-watchos/blob/main/js/src/fetch.ts#L67)

#### Parameters

##### cb

(`value`, `key`, `parent`) => `void`

#### Returns

`void`

***

### get()

> **get**(`name`): `string` \| `null`

Defined in: [js/src/fetch.ts:50](https://github.com/emindeniz99/react-watchos/blob/main/js/src/fetch.ts#L50)

#### Parameters

##### name

`string`

#### Returns

`string` \| `null`

***

### has()

> **has**(`name`): `boolean`

Defined in: [js/src/fetch.ts:53](https://github.com/emindeniz99/react-watchos/blob/main/js/src/fetch.ts#L53)

#### Parameters

##### name

`string`

#### Returns

`boolean`

***

### set()

> **set**(`name`, `value`): `void`

Defined in: [js/src/fetch.ts:56](https://github.com/emindeniz99/react-watchos/blob/main/js/src/fetch.ts#L56)

#### Parameters

##### name

`string`

##### value

`string`

#### Returns

`void`

***

### toJSON()

> **toJSON**(): `Record`\<`string`, `string`\>

Defined in: [js/src/fetch.ts:72](https://github.com/emindeniz99/react-watchos/blob/main/js/src/fetch.ts#L72)

#### Returns

`Record`\<`string`, `string`\>
