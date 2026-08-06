[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / PluralRule

# Type Alias: PluralRule

> **PluralRule** = (`language`, `count`) => [`PluralCategory`](PluralCategory.md)

Defined in: [js/src/i18n.tsx:64](https://github.com/emindeniz99/react-watchos/blob/main/js/src/i18n.tsx#L64)

Selects the plural category for a count in a language. QuickJS has no
 `Intl.PluralRules`, so the rule is a plain function — inject `cldrPluralRule`
 (canonical, all languages) or your own.

## Parameters

### language

`string`

### count

`number`

## Returns

[`PluralCategory`](PluralCategory.md)
