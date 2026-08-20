[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthAuthorizationOptions

# Interface: HealthAuthorizationOptions

Defined in: [js/src/health.ts:77](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L77)

Options for [requestHealthAuthorization](../functions/requestHealthAuthorization.md).

## Properties

### read

> **read**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)[]

Defined in: [js/src/health.ts:79](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L79)

Quantity types to ask for.

***

### sleep?

> `optional` **sleep?**: `boolean`

Defined in: [js/src/health.ts:82](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L82)

Also ask for sleep analysis — a HealthKit *category* type, so it isn't
 expressible in `read`. Required before [querySleepSamples](../functions/querySleepSamples.md).
