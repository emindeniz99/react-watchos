[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [testing](../README.md) / pushDeepLink

# Function: pushDeepLink()

> **pushDeepLink**(`url`): `boolean`

Defined in: [js/src/testing.ts:246](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L246)

Drives navigation the way the platform does. A `NavigationLink` press is
confirmed by the NATIVE stack (ARCH-09's propose→confirm transaction), so
`dispatchEvent({event: "press"})` on a link deliberately returns
`{handled: false}` in a JS-only test — there is no native stack to confirm
it. Tests navigate through the deep-link channel instead, exactly like a
widget tap or notification would:

```tsx
mountApp(<App />, host); // App wraps NavigationProvider scheme="myapp"
pushDeepLink("myapp://settings");
```

Requires a mounted app (runApp installs the native-event channel) and a
`NavigationProvider` with a matching `scheme`.

## Parameters

### url

`string`

## Returns

`boolean`
