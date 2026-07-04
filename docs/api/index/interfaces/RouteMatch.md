[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / RouteMatch

# Interface: RouteMatch

Defined in: [js/src/navigation.tsx:74](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/navigation.tsx#L74)

## Properties

### params

> **params**: [`RouteParams`](../type-aliases/RouteParams.md)

Defined in: [js/src/navigation.tsx:75](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/navigation.tsx#L75)

***

### score

> **score**: `number`

Defined in: [js/src/navigation.tsx:78](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/navigation.tsx#L78)

Higher = more specific. Literal +2, param +1, catch-all -1, so a
concrete route beats a catch-all that also happens to match it.
