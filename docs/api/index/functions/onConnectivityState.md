[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onConnectivityState

# Function: onConnectivityState()

> **onConnectivityState**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/connectivity.ts:419](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L419)

Runs `handler` whenever the session state changes — activation completing,
reachability flipping, or the companion app being installed/removed. Those
three are the *complete* set of state callbacks watchOS delivers (there is
no watch-side `sessionWatchStateDidChange`), so one event covers them all.
Same caveat as [getConnectivityState](getConnectivityState.md): observe, don't gate.

## Parameters

### handler

(`state`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
