[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / getURLScheme

# Function: getURLScheme()

> **getURLScheme**(): `string`

Defined in: [js/src/navigation.tsx:63](https://github.com/emindeniz99/react-watchos/blob/main/js/src/navigation.tsx#L63)

The app's custom URL scheme. The native host injects it as
`globalThis.__urlScheme` at boot, sourced from the app's registered
`CFBundleURLSchemes` — which the config plugin's `scheme` option writes (it
defaults to your bundle id, so two apps never collide on a shared scheme).
Falls back to `"reactwatch"` only with no host (Node/tests); a real build
always injects the real value, so both processes agree without you wiring the
scheme in two places.

## Returns

`string`
