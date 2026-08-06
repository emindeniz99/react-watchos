[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NavigationRoute

# Function: NavigationRoute()

> **NavigationRoute**(`props`): `Element`

Defined in: [js/src/navigation.tsx:442](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/navigation.tsx#L442)

A route in a NavigationStack. `path` may carry dynamic segments
(`/list/[id]`, `/shop/[name]/[[...rest]]`); when this route is active its
params are available to descendants through useParams().

The screen child mounts LAZILY (ARCH-09): children render — and serialize
across the bridge — only while this route is the root's winner or one of
the active stack's, so an inactive screen's effects (e.g. a BLE connect)
wait for first open instead of running at launch, and the committed tree
carries only what's on the stack. This is safe because navigation is a
confirmed transaction, not an optimistic push: native proposes a path via
`pathChange`, this dispatch folds it and commits the newly mounted subtree
synchronously (the CX-010 forced flush), and only the returned `accepted`
verdict lets native animate — by which time the destination's children are
already in the tree it holds one decode-hop later (NodeView.swift shows a
neutral placeholder for exactly that beat). Every entry of a multi-screen
stack stays mounted while covered — only the TOP is focused — but a popped
screen unmounts and its state is dropped; persist what must survive
(React Navigation behaves the same way).

## Parameters

### props

[`NavigationRouteProps`](../interfaces/NavigationRouteProps.md)

## Returns

`Element`
