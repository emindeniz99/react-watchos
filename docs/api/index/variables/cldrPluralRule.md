[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / cldrPluralRule

# Variable: cldrPluralRule

> `const` **cldrPluralRule**: [`PluralRule`](../type-aliases/PluralRule.md)

Defined in: [js/src/i18n.tsx:92](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/i18n.tsx#L92)

Canonical CLDR cardinal rule for ALL ~220 languages, backed by
`plurals-cldr` (nodeca) — a ~2.7 KB gz, zero-`Intl` data table, the same
CLDR source the big i18n libraries' build tools use. Opt in when you need
correct plurals beyond English one/other:

  createTranslations({ resources, fallbackLanguage: "en",
                       language: deviceLanguage, pluralRule: cldrPluralRule })

We deliberately keep this OFF the default path so an English-only app pays
nothing for the table (bundle discipline); it tree-shakes out unless
imported. An unknown language falls back to the English rule.
