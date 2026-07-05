[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SecureFieldProps

# Type Alias: SecureFieldProps

> **SecureFieldProps** = [`TextFieldProps`](../interfaces/TextFieldProps.md)

Defined in: [js/src/components.ts:324](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L324)

Masked text entry (passwords, PINs). Identical surface to [TextFieldProps](../interfaces/TextFieldProps.md)
— `value`/`placeholder`/`onChange`/`autoFocus` behave the same — but the
characters are obscured on screen, and the watchOS secure-entry modal offers
no dictation or Scribble (only the on-screen keyboard), by system design.
