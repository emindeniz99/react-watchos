[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SecureFieldProps

# Type Alias: SecureFieldProps

> **SecureFieldProps** = [`TextFieldProps`](../interfaces/TextFieldProps.md)

Defined in: [js/src/components.ts:348](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L348)

Masked text entry (passwords, PINs). Identical surface to [TextFieldProps](../interfaces/TextFieldProps.md)
— `value`/`placeholder`/`onChange`/`autoFocus` behave the same — but the
characters are obscured on screen, and the watchOS secure-entry modal offers
no dictation or Scribble (only the on-screen keyboard), by system design.
