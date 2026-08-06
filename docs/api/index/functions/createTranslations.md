[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / createTranslations

# Function: createTranslations()

> **createTranslations**(`config`): [`Translations`](../interfaces/Translations.md)

Defined in: [js/src/i18n.tsx:162](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/i18n.tsx#L162)

Builds a Translations lookup — pure over its config (closes over the
 resources), so re-creating it for a new `language` is cheap; do that when
 the device language resolves. Wire never sees any of this.

## Parameters

### config

[`TranslationConfig`](../interfaces/TranslationConfig.md)

## Returns

[`Translations`](../interfaces/Translations.md)
