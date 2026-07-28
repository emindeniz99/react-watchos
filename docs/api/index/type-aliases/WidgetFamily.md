[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetFamily

# Type Alias: WidgetFamily

> **WidgetFamily** = `"accessoryCircular"` \| `"accessoryRectangular"` \| `"accessoryInline"` \| `"accessoryCorner"`

Defined in: [js/src/widgets.ts:27](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L27)

React-rendered WidgetKit timelines (watch complications and Smart Stack
widgets). Widget extensions are not long-running processes, so the
watch app's React instance renders timelines ahead of time and
publishes them through __host.publishWidgets; the widget extension
(targets/widget) decodes the stored payload and renders it natively.
This is Apple's "keep your complications up to date" model with React
as the timeline author.
