[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthAuthorizationOptions

# Interface: HealthAuthorizationOptions

Defined in: [js/src/health.ts:67](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L67)

Options for [requestHealthAuthorization](../functions/requestHealthAuthorization.md).

## Properties

### read

> **read**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)[]

Defined in: [js/src/health.ts:69](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L69)

Quantity types to ask for.

***

### sleep?

> `optional` **sleep?**: `boolean`

Defined in: [js/src/health.ts:72](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L72)

Also ask for sleep analysis — a HealthKit *category* type, so it isn't
 expressible in `read`. Required before [querySleepSamples](../functions/querySleepSamples.md).
