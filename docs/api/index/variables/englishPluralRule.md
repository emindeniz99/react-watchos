[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / englishPluralRule

# Variable: englishPluralRule

> `const` **englishPluralRule**: [`PluralRule`](../type-aliases/PluralRule.md)

Defined in: [js/src/i18n.tsx:76](https://github.com/emindeniz99/react-watchos/blob/main/js/src/i18n.tsx#L76)

The zero-dependency DEFAULT — English/Germanic `one`/`other` only. Correct
for en/de/nl/… and any two-form cardinal, but WRONG for Arabic, the Slavic
languages (few/many), etc. It's the default because most watch apps are
single-language and we keep the base bundle lean (no CLDR data unless asked).

**If your app targets a language with richer plurals, pass
`cldrPluralRule`** (or your own `PluralRule`) so `few`/`many`/`two`/`zero`
resolve correctly — the English default would silently pick `other`.
