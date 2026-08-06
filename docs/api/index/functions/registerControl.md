[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / registerControl

# Function: registerControl()

> **registerControl**(`definition`): `void`

Defined in: [js/src/widgets.ts:309](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/widgets.ts#L309)

Publishes metadata for a control the consumer has ALREADY declared in Swift.

`registerControl` **re-labels a control; it cannot create one.** A
`ControlWidget` is a static Swift type inside the widget extension's `@main`
`WidgetBundle`, and its `kind` and `AppIntent` are compiled in — so JS can
supply the label, symbol, action label and toggle state that the Swift side
reads back through `reactControlMetadata`/`reactControlToggle`, but a `kind`
with no matching Swift declaration shows up nowhere. Whether a control is a
button or a toggle is likewise a Swift-side choice of template.

This is the same inherent constraint as widget `kind`s, not a defect: WidgetKit
discovers controls from the bundle's static type list, which exists before any
JS runs.

## Parameters

### definition

[`ControlDefinition`](../interfaces/ControlDefinition.md)

## Returns

`void`
