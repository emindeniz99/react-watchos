[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetDefinition

# Interface: WidgetDefinition

Defined in: [js/src/widgets.ts:294](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L294)

## Properties

### families

> **families**: [`WidgetFamily`](../type-aliases/WidgetFamily.md)[]

Defined in: [js/src/widgets.ts:297](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L297)

***

### instances?

> `optional` **instances?**: () => `string`[]

Defined in: [js/src/widgets.ts:306](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L306)

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

Defined in: [js/src/widgets.ts:296](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L296)

Matches the WidgetKit `kind` in the Swift widget extension.

***

### render

> **render**: (`context`) => [`WidgetTimeline`](WidgetTimeline.md)

Defined in: [js/src/widgets.ts:298](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L298)

#### Parameters

##### context

[`WidgetRenderContext`](WidgetRenderContext.md)

#### Returns

[`WidgetTimeline`](WidgetTimeline.md)
