[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ConnectivityState

# Interface: ConnectivityState

Defined in: [js/src/connectivity.ts:152](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L152)

A snapshot of the WCSession, for **observability only** — see
 [getConnectivityState](../functions/getConnectivityState.md).

## Properties

### activationState

> **activationState**: `"notActivated"` \| `"inactive"` \| `"activated"`

Defined in: [js/src/connectivity.ts:153](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L153)

***

### companionAppInstalled

> **companionAppInstalled**: `boolean`

Defined in: [js/src/connectivity.ts:157](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L157)

***

### hasContentPending

> **hasContentPending**: `boolean`

Defined in: [js/src/connectivity.ts:158](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L158)

***

### reachable

> **reachable**: `boolean`

Defined in: [js/src/connectivity.ts:156](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L156)

Apple: valid **only** for a session that activated successfully; ignore
 it while `activationState` is anything but `"activated"`.
