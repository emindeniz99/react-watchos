[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / IAPProduct

# Interface: IAPProduct

Defined in: [js/src/iap.ts:12](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/iap.ts#L12)

In-app purchase (StoreKit 2). Products and entitlements are resolved
natively; JS drives the flow. A watch app can sell consumables,
non-consumables, and subscriptions the same as iOS.

All calls reject (INVOKE error) on a StoreKit failure — a declined purchase
resolves with `{ status: "userCancelled" }` rather than rejecting, so the UI
can distinguish "failed" from "user backed out".

## Properties

### description

> **description**: `string`

Defined in: [js/src/iap.ts:15](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/iap.ts#L15)

***

### displayName

> **displayName**: `string`

Defined in: [js/src/iap.ts:14](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/iap.ts#L14)

***

### displayPrice

> **displayPrice**: `string`

Defined in: [js/src/iap.ts:17](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/iap.ts#L17)

Localized price string, e.g. "$1.99".

***

### id

> **id**: `string`

Defined in: [js/src/iap.ts:13](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/iap.ts#L13)

***

### price

> **price**: `number`

Defined in: [js/src/iap.ts:19](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/iap.ts#L19)

Numeric price in the storefront currency.

***

### type

> **type**: `"consumable"` \| `"nonConsumable"` \| `"autoRenewable"` \| `"nonRenewable"`

Defined in: [js/src/iap.ts:20](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/iap.ts#L20)
