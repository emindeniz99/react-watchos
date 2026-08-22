[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [testing](../README.md) / resetApp

# Function: resetApp()

> **resetApp**(): `void`

Defined in: [js/src/testing.ts:88](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L88)

The shared `afterEach` for any file that mounts an app: disposes every
`mountApp` root (newest first), clears the module-scope registries
(native listeners, intents, widgets, sensor counts) and removes the
`__host`/`__urlScheme` globals a test installed. A throwing effect cleanup
doesn't abort the rest of the teardown; the first error is rethrown at the
end so the failure stays loud.

## Returns

`void`
