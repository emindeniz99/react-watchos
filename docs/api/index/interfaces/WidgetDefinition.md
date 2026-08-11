[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetDefinition

# Interface: WidgetDefinition

Defined in: [js/src/widgets.ts:235](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L235)

## Properties

### families

> **families**: [`WidgetFamily`](../type-aliases/WidgetFamily.md)[]

Defined in: [js/src/widgets.ts:238](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L238)

***

### instances?

> `optional` **instances?**: () => `string`[]

Defined in: [js/src/widgets.ts:247](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L247)

Optional: expand this widget into one timeline per instance id, published
under the key `kind/id` (instead of just `kind`). Use for a configurable
widget whose native AppIntentConfiguration picks an instance per
complication — e.g. one shopping list per id. `render` then receives the
id as `context.instanceId`.

#### Returns

`string`[]

***

### kind

> **kind**: `string`

Defined in: [js/src/widgets.ts:237](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L237)

Matches the WidgetKit `kind` in the Swift widget extension.

***

### render

> **render**: (`context`) => [`WidgetTimeline`](WidgetTimeline.md)

Defined in: [js/src/widgets.ts:239](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L239)

#### Parameters

##### context

[`WidgetRenderContext`](WidgetRenderContext.md)

#### Returns

[`WidgetTimeline`](WidgetTimeline.md)
