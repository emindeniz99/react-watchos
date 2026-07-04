[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / InspectorError

# Interface: InspectorError

Defined in: [js/src/inspector.ts:34](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/inspector.ts#L34)

A recorded error for the viewer's error panel.

## Properties

### componentStack?

> `optional` **componentStack?**: `string`

Defined in: [js/src/inspector.ts:40](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/inspector.ts#L40)

React's componentStack (which subtree threw), when captured from an
 ErrorBoundary via `onError={captureError}`.

***

### message

> **message**: `string`

Defined in: [js/src/inspector.ts:35](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/inspector.ts#L35)

***

### stack?

> `optional` **stack?**: `string`

Defined in: [js/src/inspector.ts:37](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/inspector.ts#L37)

The JS Error stack, when the captured value carried one.
