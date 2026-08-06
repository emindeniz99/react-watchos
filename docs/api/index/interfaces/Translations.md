[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / Translations

# Interface: Translations

Defined in: [js/src/i18n.tsx:102](https://github.com/emindeniz99/react-watchos/blob/main/js/src/i18n.tsx#L102)

## Properties

### language

> `readonly` **language**: `string`

Defined in: [js/src/i18n.tsx:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/i18n.tsx#L104)

The active language (as resolved from getDeviceInfo().language).

## Methods

### t()

> **t**(`key`, `params?`): `string`

Defined in: [js/src/i18n.tsx:112](https://github.com/emindeniz99/react-watchos/blob/main/js/src/i18n.tsx#L112)

Looks up `key` in the active language's table (falling back to the bare
language prefix, then the fallback language), interpolates `{name}`
placeholders from `params`, and selects a plural form when the resource
is a plural bundle. A missing key returns the key itself — a visible
"untranslated" marker, never a crash (NF-32 fail-loud posture).

#### Parameters

##### key

`string`

##### params?

[`TranslationParams`](TranslationParams.md)

#### Returns

`string`
