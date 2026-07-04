[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / PluralRule

# Type Alias: PluralRule

> **PluralRule** = (`language`, `count`) => [`PluralCategory`](PluralCategory.md)

Defined in: js/src/i18n.tsx:47

Selects the plural category for a count in a language. QuickJS has no
 `Intl.PluralRules`, so the app supplies the rule for languages whose
 plural logic isn't English one/other.

## Parameters

### language

`string`

### count

`number`

## Returns

[`PluralCategory`](PluralCategory.md)
