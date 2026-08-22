[**react-watchos API**](../README.md)

***

[react-watchos API](../README.md) / testing

# testing

Query helpers for asserting on committed trees, exported as
`react-watchos/testing`. Pair with `runApp(element, new MemoryHost())`
(or `renderToTree`) — every consumer was otherwise re-writing `findByType`.

Serialization quirks these helpers account for (see docs/updates.md):
  - `<Text>` content folds into `props.text`, not `children`.
  - function props (onPress, onChange, …) serialize to the literal `true`.

(`@module` pins the typedoc module name — see the note in src/index.ts.)

## Interfaces

- [InvokeHost](interfaces/InvokeHost.md)
- [RecordedInvoke](interfaces/RecordedInvoke.md)

## Type Aliases

- [InvokeHandlers](type-aliases/InvokeHandlers.md)

## Functions

- [findByText](functions/findByText.md)
- [findByType](functions/findByType.md)
- [installInvokeHost](functions/installInvokeHost.md)
- [mountApp](functions/mountApp.md)
- [pushDeepLink](functions/pushDeepLink.md)
- [resetApp](functions/resetApp.md)
