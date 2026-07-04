[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NavigationRoute

# Function: NavigationRoute()

> **NavigationRoute**(`props`): `Element`

Defined in: [js/src/navigation.tsx:348](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/navigation.tsx#L348)

A route in a NavigationStack. `path` may carry dynamic segments
(`/list/[id]`, `/shop/[name]/[[...rest]]`); when this route is active its
params are available to descendants through useParams().

The screen child mounts eagerly — every route in the stack is serialized at
all times, even when inactive — so a screen's effects (e.g. a BLE connect)
run at launch, not on first open. This is deliberate, not an oversight:
NavigationStack is a *controlled* native push (NodeView.swift), and a link
tap or swipe-back drives the push optimistically (RoutedNavigationStack's
`pendingPath`) before the `pathChange` event round-trips to JS. SwiftUI runs
its `navigationDestination` closure for the new route — reading this node's
children straight out of the current serialized tree — in that same frame,
one bridge hop *before* JS re-renders with the new active route. Gating the
children on `active` would therefore hand the destination an empty subtree at
push time, flashing a blank screen until the JS ack lands. Lazy mounting
needs a native change (defer the destination render until JS confirms the
path, or carry the pushed subtree across the bridge) and on-device
validation; it can't be done safely in JS alone.

## Parameters

### props

[`NavigationRouteProps`](../interfaces/NavigationRouteProps.md)

## Returns

`Element`
