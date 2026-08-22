[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NavigationStack

# Function: NavigationStack()

> **NavigationStack**(`props`): `Element`

Defined in: [js/src/navigation.tsx:404](https://github.com/emindeniz99/react-watchos/blob/main/js/src/navigation.tsx#L404)

Native push stack. Publishes the active route (top of the stack) so the
matching <NavigationRoute> can expose its params via useParams(), and the
per-entry winners so only the active stack's screens mount (ARCH-09).

Two modes, mirroring the native RoutedNavigationStack (NodeView.swift):
 - **Controlled** — you pass `path`; JS is the source of truth and the host's
   `pathChange` events flow to your `onPathChange` for you to fold back in.
   Fold SYNCHRONOUSLY (a plain setState in the handler is enough — the
   dispatch flushes it): navigation is a confirmed transaction, and a
   proposal your handler didn't fold reads as declined, so native won't
   navigate.
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
