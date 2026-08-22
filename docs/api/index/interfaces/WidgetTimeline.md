[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetTimeline

# Interface: WidgetTimeline

Defined in: [js/src/widgets.ts:285](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L285)

## Properties

### entries

> **entries**: [`WidgetTimelineEntry`](WidgetTimelineEntry.md)[]

Defined in: [js/src/widgets.ts:286](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L286)

***

### relevantContexts?

> `optional` **relevantContexts?**: [`RelevantContext`](../type-aliases/RelevantContext.md)[]

Defined in: [js/src/widgets.ts:290](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L290)

Smart Stack predictive clues — when/where to surface this widget.

***

### reloadAfter?

> `optional` **reloadAfter?**: `number` \| `Date`

Defined in: [js/src/widgets.ts:288](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L288)

Ask WidgetKit to re-publish after this time (ms or Date).
