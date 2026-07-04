[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetRenderContext

# Interface: WidgetRenderContext

Defined in: [js/src/widgets.ts:32](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L32)

## Properties

### family

> **family**: [`WidgetFamily`](../type-aliases/WidgetFamily.md)

Defined in: [js/src/widgets.ts:33](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L33)

***

### instanceId?

> `optional` **instanceId?**: `string`

Defined in: [js/src/widgets.ts:41](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L41)

For a widget with `instances`, the id of the instance being rendered.
The published key is `kind/instanceId`, which a configurable widget's
native provider looks up from the user's per-complication selection.

***

### now

> **now**: `number`

Defined in: [js/src/widgets.ts:35](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L35)

Timeline render time, ms since epoch.
