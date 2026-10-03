[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetTimeline

# Interface: WidgetTimeline

Defined in: [js/src/widgets.ts:284](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L284)

## Properties

### entries

> **entries**: [`WidgetTimelineEntry`](WidgetTimelineEntry.md)[]

Defined in: [js/src/widgets.ts:285](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L285)

***

### relevantContexts?

> `optional` **relevantContexts?**: [`RelevantContext`](../type-aliases/RelevantContext.md)[]

Defined in: [js/src/widgets.ts:289](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L289)

Smart Stack predictive clues — when/where to surface this widget.

***

### reloadAfter?

> `optional` **reloadAfter?**: `number` \| `Date`

Defined in: [js/src/widgets.ts:287](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L287)

Ask WidgetKit to re-publish after this time (ms or Date).
