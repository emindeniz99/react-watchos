[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ControlDefinition

# Interface: ControlDefinition

Defined in: [js/src/widgets.ts:97](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/widgets.ts#L97)

Metadata for a WidgetKit Control (watchOS 26 Control Center / Action
button). Controls are templated by the OS — a symbol plus a label, not
a free-form view — so React authors the metadata and handles the
control's AppIntent via registerIntent.

## Properties

### intent

> **intent**: `string`

Defined in: [js/src/widgets.ts:101](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/widgets.ts#L101)

Intent name dispatched back into JS when the control is used.

***

### kind

> **kind**: `string`

Defined in: [js/src/widgets.ts:99](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/widgets.ts#L99)

WidgetKit control kind, e.g. "hydration.addGlass".

***

### label

> **label**: `string`

Defined in: [js/src/widgets.ts:102](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/widgets.ts#L102)

***

### systemName?

> `optional` **systemName?**: `string`

Defined in: [js/src/widgets.ts:103](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/widgets.ts#L103)
