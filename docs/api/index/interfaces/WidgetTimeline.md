[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetTimeline

# Interface: WidgetTimeline

Defined in: [js/src/widgets.ts:223](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L223)

## Properties

### entries

> **entries**: [`WidgetTimelineEntry`](WidgetTimelineEntry.md)[]

Defined in: [js/src/widgets.ts:224](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L224)

***

### relevantContexts?

> `optional` **relevantContexts?**: `RelevantContext`[]

Defined in: [js/src/widgets.ts:228](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L228)

Smart Stack predictive clues — when/where to surface this widget.

***

### reloadAfter?

> `optional` **reloadAfter?**: `number` \| `Date`

Defined in: [js/src/widgets.ts:226](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L226)

Ask WidgetKit to re-publish after this time (ms or Date).
