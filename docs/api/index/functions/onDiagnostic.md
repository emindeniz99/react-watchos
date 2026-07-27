[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onDiagnostic

# Function: onDiagnostic()

> **onDiagnostic**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/diagnostics.ts:53](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L53)

Subscribes `handler` to host diagnostics — e.g. to forward OTA rollback or
budget-breach records to an app's own telemetry. Returns an unsubscribe
function; use it as a React effect's cleanup.

## Parameters

### handler

(`diagnostic`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
