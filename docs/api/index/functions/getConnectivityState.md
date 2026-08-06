[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / getConnectivityState

# Function: getConnectivityState()

> **getConnectivityState**(): `Promise`\<[`ConnectivityState`](../interfaces/ConnectivityState.md)\>

Defined in: [js/src/connectivity.ts:276](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L276)

A snapshot of the session: activation, reachability, whether the companion
iPhone app is installed, and whether WCSession still has content queued.

**Observability, not a gate.** Do not branch "can I send now" on
`reachable`: the field lesson recorded in
`notes/watchconnectivity-reliability.md` is that `isReachable` returns
`true` while delivery is failing ("a random bool generator with a confidence
problem"). Send and await an ack instead. This exists so a UI can *show* a
connection state and so a bug report can carry one — nothing more.

## Returns

`Promise`\<[`ConnectivityState`](../interfaces/ConnectivityState.md)\>
