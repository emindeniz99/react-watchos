[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / Keychain

# Variable: Keychain

> `const` **Keychain**: `object`

Defined in: [js/src/keychain.ts:11](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/keychain.ts#L11)

Keychain secure storage (Security framework) — for tokens and secrets that
must NOT live in `Storage` (App Group UserDefaults is not encrypted at rest
the way the Keychain is). Items are scoped to this app, `whenUnlocked`
accessibility. Values are strings (base64 your binary).

Async because the Keychain call crosses the invoke channel; it's cheap.

## Type Declaration

### delete()

> **delete**(`key`): `Promise`\<`void`\>

Removes the secret (no-op when absent).

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`void`\>

### get()

> **get**(`key`): `Promise`\<`string` \| `null`\>

Returns the stored secret, or null when absent.

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`string` \| `null`\>

### set()

> **set**(`key`, `value`): `Promise`\<`void`\>

Stores (or replaces) a secret under `key`.

#### Parameters

##### key

`string`

##### value

`string`

#### Returns

`Promise`\<`void`\>
