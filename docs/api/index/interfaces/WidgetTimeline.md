[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetTimeline

# Interface: WidgetTimeline

Defined in: [js/src/widgets.ts:286](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L286)

## Properties

### entries

> **entries**: [`WidgetTimelineEntry`](WidgetTimelineEntry.md)[]

Defined in: [js/src/widgets.ts:287](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L287)

***

### relevantContexts?

> `optional` **relevantContexts?**: [`RelevantContext`](../type-aliases/RelevantContext.md)[]

Defined in: [js/src/widgets.ts:291](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L291)

Smart Stack predictive clues — when/where to surface this widget.

***

### reloadAfter?

> `optional` **reloadAfter?**: `number` \| `Date`

Defined in: [js/src/widgets.ts:289](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L289)

Ask WidgetKit to re-publish after this time (ms or Date).
