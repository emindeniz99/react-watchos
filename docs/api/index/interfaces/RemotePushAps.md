[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / RemotePushAps

# Interface: RemotePushAps

Defined in: [js/src/remotePush.ts:20](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L20)

The `aps` dictionary of an APNs payload (Apple's keys, hence the quoted
 hyphenated names). Everything is optional — a background push may carry
 only `content-available`; server-custom keys ride the index signature.

## Indexable

> \[`key`: `string`\]: `unknown`

## Properties

### alert?

> `optional` **alert?**: `string` \| \{ `body?`: `string`; `subtitle?`: `string`; `title?`: `string`; \}

Defined in: [js/src/remotePush.ts:21](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L21)

***

### badge?

> `optional` **badge?**: `number`

Defined in: [js/src/remotePush.ts:22](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L22)

***

### category?

> `optional` **category?**: `string`

Defined in: [js/src/remotePush.ts:24](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L24)

***

### content-available?

> `optional` **content-available?**: `0` \| `1`

Defined in: [js/src/remotePush.ts:26](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L26)

***

### mutable-content?

> `optional` **mutable-content?**: `0` \| `1`

Defined in: [js/src/remotePush.ts:27](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L27)

***

### sound?

> `optional` **sound?**: `string`

Defined in: [js/src/remotePush.ts:23](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L23)

***

### thread-id?

> `optional` **thread-id?**: `string`

Defined in: [js/src/remotePush.ts:25](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L25)
