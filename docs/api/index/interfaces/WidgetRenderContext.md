[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetRenderContext

# Interface: WidgetRenderContext

Defined in: [js/src/widgets.ts:33](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L33)

## Properties

### family

> **family**: [`WidgetFamily`](../type-aliases/WidgetFamily.md)

Defined in: [js/src/widgets.ts:34](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L34)

***

### instanceId?

> `optional` **instanceId?**: `string`

Defined in: [js/src/widgets.ts:42](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L42)

For a widget with `instances`, the id of the instance being rendered.
The published key is `kind/instanceId`, which a configurable widget's
native provider looks up from the user's per-complication selection.

***

### now

> **now**: `number`

Defined in: [js/src/widgets.ts:36](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L36)

Timeline render time, ms since epoch.
