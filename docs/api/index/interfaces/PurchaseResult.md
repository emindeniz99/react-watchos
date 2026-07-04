[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / PurchaseResult

# Interface: PurchaseResult

Defined in: [js/src/iap.ts:23](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/iap.ts#L23)

## Properties

### productId?

> `optional` **productId?**: `string`

Defined in: [js/src/iap.ts:26](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/iap.ts#L26)

The transaction's product id when status is "success".

***

### status

> **status**: `"success"` \| `"pending"` \| `"userCancelled"`

Defined in: [js/src/iap.ts:24](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/iap.ts#L24)

***

### transactionId?

> `optional` **transactionId?**: `string`

Defined in: [js/src/iap.ts:28](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/iap.ts#L28)

Opaque transaction id, for your server to verify.
