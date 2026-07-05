[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NavigationStack

# Function: NavigationStack()

> **NavigationStack**(`props`): `Element`

Defined in: [js/src/navigation.tsx:325](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/navigation.tsx#L325)

Native push stack. Publishes the active route (top of the stack) so the
matching <NavigationRoute> can expose its params via useParams().

Two modes, mirroring the native RoutedNavigationStack (NodeView.swift):
 - **Controlled** — you pass `path`; JS is the source of truth and the host's
   `pathChange` events flow to your `onPathChange` for you to fold back in.
 - **Uncontrolled** — you pass neither; the native stack drives itself
   (NavigationLink pushes, swipe-back) and reports each change via
   `pathChange`. We track that here so `active` follows the real stack instead
   of being pinned to "/" — otherwise useParams()/useIsFocused() would be
   wrong on every pushed screen. A user `onPathChange` still fires either way.

## Parameters

### props

[`NavigationStackProps`](../interfaces/NavigationStackProps.md)

## Returns

`Element`
