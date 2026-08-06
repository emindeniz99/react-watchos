[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / InspectorError

# Interface: InspectorError

Defined in: [js/src/inspector.ts:56](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/inspector.ts#L56)

A recorded error for the viewer's error panel.

## Properties

### componentStack?

> `optional` **componentStack?**: `string`

Defined in: [js/src/inspector.ts:62](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/inspector.ts#L62)

React's componentStack (which subtree threw), when captured from an
 ErrorBoundary via `onError={captureError}`.

***

### message

> **message**: `string`

Defined in: [js/src/inspector.ts:57](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/inspector.ts#L57)

***

### stack?

> `optional` **stack?**: `string`

Defined in: [js/src/inspector.ts:59](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/inspector.ts#L59)

The JS Error stack, when the captured value carried one.
