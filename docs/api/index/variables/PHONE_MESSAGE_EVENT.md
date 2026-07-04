[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / PHONE\_MESSAGE\_EVENT

# Variable: PHONE\_MESSAGE\_EVENT

> `const` **PHONE\_MESSAGE\_EVENT**: `"watchConnectivity"` = `"watchConnectivity"`

Defined in: [js/src/connectivity.ts:14](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/connectivity.ts#L14)

Phone <-> watch messaging over WatchConnectivity, surfaced through the
native-event channel. Incoming phone messages arrive as a native push
under PHONE_MESSAGE_EVENT (so they commit instantly via runSync);
sendToPhone goes out through the host bridge to WCSession.
