[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetDefinition

# Interface: WidgetDefinition

Defined in: [js/src/widgets.ts:231](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L231)

## Properties

### families

> **families**: [`WidgetFamily`](../type-aliases/WidgetFamily.md)[]

Defined in: [js/src/widgets.ts:234](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L234)

***

### instances?

> `optional` **instances?**: () => `string`[]

Defined in: [js/src/widgets.ts:243](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L243)

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

Defined in: [js/src/widgets.ts:233](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L233)

Matches the WidgetKit `kind` in the Swift widget extension.

***

### render

> **render**: (`context`) => [`WidgetTimeline`](WidgetTimeline.md)

Defined in: [js/src/widgets.ts:235](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L235)

#### Parameters

##### context

[`WidgetRenderContext`](WidgetRenderContext.md)

#### Returns

[`WidgetTimeline`](WidgetTimeline.md)
