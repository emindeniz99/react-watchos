[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WidgetFamily

# Type Alias: WidgetFamily

> **WidgetFamily** = `"accessoryCircular"` \| `"accessoryRectangular"` \| `"accessoryInline"` \| `"accessoryCorner"`

Defined in: [js/src/widgets.ts:26](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/widgets.ts#L26)

React-rendered WidgetKit timelines (watch complications and Smart Stack
widgets). Widget extensions are not long-running processes, so the
watch app's React instance renders timelines ahead of time and
publishes them through __host.publishWidgets; the widget extension
(targets/widget) decodes the stored payload and renders it natively.
This is Apple's "keep your complications up to date" model with React
as the timeline author.
