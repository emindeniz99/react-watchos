[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / useFocusEffect

# Function: useFocusEffect()

> **useFocusEffect**(`effect`): `void`

Defined in: [js/src/navigation.tsx:308](https://github.com/emindeniz99/react-watchos/blob/main/js/src/navigation.tsx#L308)

Runs `effect` when the enclosing screen gains focus and cleans up when it
blurs or unmounts — the watchOS analog of React Navigation's useFocusEffect.
Routes mount lazily (ARCH-09): a screen enters the tree when its route joins
the active stack, so a bare useEffect with `[]` now runs on first open, not
at launch. Focus is still narrower than mount: every entry of a multi-screen
stack stays mounted while covered (as in React Navigation), so a covered
screen's useEffect keeps running where this hook cleans up on blur. Route
focus-scoped side effects (BLE, sensor/listener subscriptions, polling)
belong here. Wrap `effect` in useCallback so it only re-runs when focus
actually changes.

## Parameters

### effect

`EffectCallback`

## Returns

`void`
