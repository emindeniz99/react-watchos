[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetTimelineEntry

# Interface: WidgetTimelineEntry

Defined in: [js/src/widgets.ts:56](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L56)

## Properties

### date

> **date**: `number` \| `Date`

Defined in: [js/src/widgets.ts:57](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L57)

***

### relevance?

> `optional` **relevance?**: [`EntryRelevance`](EntryRelevance.md)

Defined in: [js/src/widgets.ts:69](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L69)

***

### url?

> `optional` **url?**: `string`

Defined in: [js/src/widgets.ts:68](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L68)

Optional deep link opened when the complication/widget is tapped.

***

### view

> **view**: `ReactNode`

Defined in: [js/src/widgets.ts:66](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L66)

The tree for this entry. Rendered ONCE, without the React reconciler
(staticRender.ts), so it must be a pure function of its props and the
stores it reads: no effects run, state setters have nothing to re-render,
and Suspense/lazy/portals throw. Components, `memo`, `forwardRef`,
Fragments, context and the deterministic hooks all work — see
docs/ui-guide.md, "Widget components render without the reconciler".
