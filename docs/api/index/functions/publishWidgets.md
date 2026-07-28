[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / publishWidgets

# Function: publishWidgets()

> **publishWidgets**(`now?`): [`PublishedWidgets`](../interfaces/PublishedWidgets.md)

Defined in: [js/src/widgets.ts:574](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/widgets.ts#L574)

Renders all widgets and hands the payload to the native host, which
persists it to App Group storage and calls
WidgetCenter.reloadAllTimelines(). Returns the payload (tests inspect
it; a missing host method is fine on platforms without widgets).

## Parameters

### now?

`number` = `...`

## Returns

[`PublishedWidgets`](../interfaces/PublishedWidgets.md)
