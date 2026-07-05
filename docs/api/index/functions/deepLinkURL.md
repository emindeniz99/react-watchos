[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / deepLinkURL

# Function: deepLinkURL()

> **deepLinkURL**(`route`, `scheme?`): `string`

Defined in: [js/src/navigation.tsx:75](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/navigation.tsx#L75)

Build a deep-link URL from a route (`deepLinkURL("/hydration")` ->
`"<scheme>://hydration"`) using the app's registered scheme. Use it for
widget entry `url`s and any `openURL` target so the URL you construct matches
what `NavigationProvider` parses — one scheme source, no literal to keep in
sync across the app, the widget, and the Info.plist.

## Parameters

### route

`string`

### scheme?

`string` = `...`

## Returns

`string`
