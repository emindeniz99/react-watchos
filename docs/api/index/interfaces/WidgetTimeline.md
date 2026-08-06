[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetTimeline

# Interface: WidgetTimeline

Defined in: [js/src/widgets.ts:226](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L226)

## Properties

### entries

> **entries**: [`WidgetTimelineEntry`](WidgetTimelineEntry.md)[]

Defined in: [js/src/widgets.ts:227](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L227)

***

### relevantContexts?

> `optional` **relevantContexts?**: [`RelevantContext`](../type-aliases/RelevantContext.md)[]

Defined in: [js/src/widgets.ts:231](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L231)

Smart Stack predictive clues — when/where to surface this widget.

***

### reloadAfter?

> `optional` **reloadAfter?**: `number` \| `Date`

Defined in: [js/src/widgets.ts:229](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L229)

Ask WidgetKit to re-publish after this time (ms or Date).
