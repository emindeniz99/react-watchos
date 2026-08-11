[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetTimeline

# Interface: WidgetTimeline

Defined in: [js/src/widgets.ts:227](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L227)

## Properties

### entries

> **entries**: [`WidgetTimelineEntry`](WidgetTimelineEntry.md)[]

Defined in: [js/src/widgets.ts:228](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L228)

***

### relevantContexts?

> `optional` **relevantContexts?**: [`RelevantContext`](../type-aliases/RelevantContext.md)[]

Defined in: [js/src/widgets.ts:232](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L232)

Smart Stack predictive clues — when/where to surface this widget.

***

### reloadAfter?

> `optional` **reloadAfter?**: `number` \| `Date`

Defined in: [js/src/widgets.ts:230](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L230)

Ask WidgetKit to re-publish after this time (ms or Date).
