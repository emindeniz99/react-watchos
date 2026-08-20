[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthAuthorizationOptions

# Interface: HealthAuthorizationOptions

Defined in: [js/src/health.ts:68](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L68)

Options for [requestHealthAuthorization](../functions/requestHealthAuthorization.md).

## Properties

### read

> **read**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)[]

Defined in: [js/src/health.ts:70](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L70)

Quantity types to ask for.

***

### sleep?

> `optional` **sleep?**: `boolean`

Defined in: [js/src/health.ts:73](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L73)

Also ask for sleep analysis — a HealthKit *category* type, so it isn't
 expressible in `read`. Required before [querySleepSamples](../functions/querySleepSamples.md).
