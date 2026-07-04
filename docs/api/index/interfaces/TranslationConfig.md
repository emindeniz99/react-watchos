[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TranslationConfig

# Interface: TranslationConfig

Defined in: js/src/i18n.tsx:73

## Properties

### fallbackLanguage

> **fallbackLanguage**: `string`

Defined in: js/src/i18n.tsx:79

Language used when the active one has no table; must exist in resources.

***

### language?

> `optional` **language?**: `string`

Defined in: js/src/i18n.tsx:82

Active language, usually `getDeviceInfo().language`. Defaults to the
 fallback (so a table with only one language still works untouched).

***

### pluralRule?

> `optional` **pluralRule?**: [`PluralRule`](../type-aliases/PluralRule.md)

Defined in: js/src/i18n.tsx:84

Plural-category selector; defaults to English one/other.

***

### resources

> **resources**: `Record`\<`string`, [`MessageTable`](../type-aliases/MessageTable.md)\>

Defined in: js/src/i18n.tsx:77

Language → its message table. Keyed by bare code ("de") and/or full
 locale ("de_DE"); lookup tries the exact active language, then its bare
 prefix, then the fallback.
