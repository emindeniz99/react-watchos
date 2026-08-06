[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / purchase

# Function: purchase()

> **purchase**(`productId`): `Promise`\<[`PurchaseResult`](../interfaces/PurchaseResult.md)\>

Defined in: [js/src/iap.ts:39](https://github.com/emindeniz99/react-watchos/blob/main/js/src/iap.ts#L39)

Starts a purchase. A user cancel resolves `{ status: "userCancelled" }`;
 a StoreKit error rejects.

## Parameters

### productId

`string`

## Returns

`Promise`\<[`PurchaseResult`](../interfaces/PurchaseResult.md)\>
