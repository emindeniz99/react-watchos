[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / useFocusEffect

# Function: useFocusEffect()

> **useFocusEffect**(`effect`): `void`

Defined in: [js/src/navigation.tsx:248](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/navigation.tsx#L248)

Runs `effect` when the enclosing screen gains focus and cleans up when it
blurs or unmounts — the watchOS analog of React Navigation's useFocusEffect.
Screens stay mounted across navigation (as in React Navigation), so a bare
useEffect with `[]` runs once at launch; route focus-scoped side effects
(BLE, sensor/listener subscriptions, polling) through this instead. Wrap
`effect` in useCallback so it only re-runs when focus actually changes.

## Parameters

### effect

`EffectCallback`

## Returns

`void`
