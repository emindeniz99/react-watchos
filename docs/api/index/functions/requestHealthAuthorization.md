[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / requestHealthAuthorization

# Function: requestHealthAuthorization()

> **requestHealthAuthorization**(`options`): `Promise`\<[`HealthAuthorizationResult`](../type-aliases/HealthAuthorizationResult.md)\>

Defined in: [js/src/health.ts:233](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L233)

Shows the HealthKit permission sheet for the given read types (a silent
no-op re-prompt if they were already asked for), and reports **whether the
sheet was going to be shown** — `"prompted"`, `"alreadyRequested"`, or
`"unavailable"` when the device has no HealthKit.

It does **not** report whether reading was granted: Apple does not tell an
app that, by design (see the module doc). The queries below also ensure
authorization for the type they read, so this exists mainly to run the sheet
at a moment you choose.

## Parameters

### options

[`HealthAuthorizationOptions`](../interfaces/HealthAuthorizationOptions.md)

## Returns

`Promise`\<[`HealthAuthorizationResult`](../type-aliases/HealthAuthorizationResult.md)\>
