[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetTimeline

# Interface: WidgetTimeline

Defined in: [js/src/widgets.ts:238](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L238)

## Properties

### entries

> **entries**: [`WidgetTimelineEntry`](WidgetTimelineEntry.md)[]

Defined in: [js/src/widgets.ts:239](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L239)

***

### relevantContexts?

> `optional` **relevantContexts?**: [`RelevantContext`](../type-aliases/RelevantContext.md)[]

Defined in: [js/src/widgets.ts:243](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L243)

Smart Stack predictive clues — when/where to surface this widget.

***

### reloadAfter?

> `optional` **reloadAfter?**: `number` \| `Date`

Defined in: [js/src/widgets.ts:241](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L241)

Ask WidgetKit to re-publish after this time (ms or Date).
