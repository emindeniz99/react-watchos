[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetDefinition

# Interface: WidgetDefinition

Defined in: [js/src/widgets.ts:234](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/widgets.ts#L234)

## Properties

### families

> **families**: [`WidgetFamily`](../type-aliases/WidgetFamily.md)[]

Defined in: [js/src/widgets.ts:237](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/widgets.ts#L237)

***

### instances?

> `optional` **instances?**: () => `string`[]

Defined in: [js/src/widgets.ts:246](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/widgets.ts#L246)

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

Defined in: [js/src/widgets.ts:236](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/widgets.ts#L236)

Matches the WidgetKit `kind` in the Swift widget extension.

***

### render

> **render**: (`context`) => [`WidgetTimeline`](WidgetTimeline.md)

Defined in: [js/src/widgets.ts:238](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/widgets.ts#L238)

#### Parameters

##### context

[`WidgetRenderContext`](WidgetRenderContext.md)

#### Returns

[`WidgetTimeline`](WidgetTimeline.md)
