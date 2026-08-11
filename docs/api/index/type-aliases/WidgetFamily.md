[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetFamily

# Type Alias: WidgetFamily

> **WidgetFamily** = `"accessoryCircular"` \| `"accessoryRectangular"` \| `"accessoryInline"` \| `"accessoryCorner"`

Defined in: [js/src/widgets.ts:28](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L28)

React-rendered WidgetKit timelines (watch complications and Smart Stack
widgets). Widget extensions are not long-running processes, so the
watch app's React instance renders timelines ahead of time and
publishes them through __host.publishWidgets; the widget extension
(targets/widget) decodes the stored payload and renders it natively.
This is Apple's "keep your complications up to date" model with React
as the timeline author.
