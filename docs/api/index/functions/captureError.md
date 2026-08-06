[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / captureError

# Function: captureError()

> **captureError**(`error`, `info?`): `void`

Defined in: [js/src/inspector.ts:71](https://github.com/emindeniz99/react-watchos/blob/main/js/src/inspector.ts#L71)

Record an error into the inspector's ring so the viewer can show WHERE the
app broke, not just that a log happened. Signature matches ErrorBoundary's
`onError`, so wiring is `<ErrorBoundary onError={captureError}>`; also fed by
the `console.error` tee. Never throws (defensive like the log tee).

## Parameters

### error

`unknown`

### info?

#### componentStack?

`string` \| `null`

## Returns

`void`
