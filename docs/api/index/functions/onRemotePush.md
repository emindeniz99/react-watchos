[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onRemotePush

# Function: onRemotePush()

> **onRemotePush**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/remotePush.ts:61](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L61)

Runs `handler` with each delivered remote notification's userInfo (the
`aps` dictionary + your server's custom keys). A registered listener is
what makes the native delegate report "new data" for a background push;
with no listener (or before the JS bundle has booted — e.g. a cold-launch
background push) the notification is dropped as "no data". Returns an
unsubscribe.

## Parameters

### handler

(`notification`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
