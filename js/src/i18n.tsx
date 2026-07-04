import type { ReactNode } from "react";
import { createContext, createElement, useContext } from "react";

/**
 * i18n Tier 3 (M7 step 3): the translation-table pattern. QuickJS ships no
 * `Intl`, so — like the theme layer (theme.tsx) — this is plain data + one
 * context, resolved in JS: the wire and the Swift interpreter never see a key.
 * The app owns its string tables; this gives them a typed lookup with
 * `{placeholder}` interpolation and a pluralization seam that doesn't need
 * ICU. Locale/number/date FORMATTING is `<FormattedText>` (step 2); THIS is
 * message translation (step 3).
 *
 *   const i18n = createTranslations({
 *     resources: {
 *       en: { hello: "Hi {name}", glasses: { one: "{count} glass", other: "{count} glasses" } },
 *       de: { hello: "Hallo {name}", glasses: { one: "{count} Glas",  other: "{count} Gläser"  } },
 *     },
 *     fallbackLanguage: "en",
 *     language: deviceLanguage, // from getDeviceInfo().language
 *   });
 *   <TranslationProvider translations={i18n}>…</TranslationProvider>
 *
 *   const { t } = useTranslation();
 *   t("hello", { name: "Emin" });          // "Hallo Emin"
 *   t("glasses", { count: 2 });            // "2 Gläser"
 */

/** A plural bundle keyed by CLDR cardinal category; `other` is required as the
 *  universal fallback so every plural resolves to *something*. */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** A message is a plain string, or a plural bundle selected by `count`. */
export type Message = string | PluralForms;
export type MessageTable = Record<string, Message>;
export type PluralCategory = keyof PluralForms;

/** Selects the plural category for a count in a language. QuickJS has no
 *  `Intl.PluralRules`, so the app supplies the rule for languages whose
 *  plural logic isn't English one/other. */
export type PluralRule = (language: string, count: number) => PluralCategory;

/** The default cardinal rule — English one/other. Correct for en and the many
 *  languages that share its two-form cardinal; override per app for others. */
export const englishPluralRule: PluralRule = (_language, count) =>
  count === 1 ? "one" : "other";

/** Interpolation values. `count` also drives plural selection. */
export interface TranslationParams {
  count?: number;
  [key: string]: string | number | undefined;
}

export interface Translations {
  /** The active language (as resolved from getDeviceInfo().language). */
  readonly language: string;
  /**
   * Looks up `key` in the active language's table (falling back to the bare
   * language prefix, then the fallback language), interpolates `{name}`
   * placeholders from `params`, and selects a plural form when the resource
   * is a plural bundle. A missing key returns the key itself — a visible
   * "untranslated" marker, never a crash (NF-32 fail-loud posture).
   */
  t(key: string, params?: TranslationParams): string;
}

export interface TranslationConfig {
  /** Language → its message table. Keyed by bare code ("de") and/or full
   *  locale ("de_DE"); lookup tries the exact active language, then its bare
   *  prefix, then the fallback. */
  resources: Record<string, MessageTable>;
  /** Language used when the active one has no table; must exist in resources. */
  fallbackLanguage: string;
  /** Active language, usually `getDeviceInfo().language`. Defaults to the
   *  fallback (so a table with only one language still works untouched). */
  language?: string;
  /** Plural-category selector; defaults to English one/other. */
  pluralRule?: PluralRule;
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** The tables to consult for the active language, most-specific first: exact
 *  match, then the bare prefix ("de_DE" → "de"), then the fallback. Ordered +
 *  de-duped so a per-KEY miss can walk to the next table. */
function tableChain(
  resources: Record<string, MessageTable>,
  language: string,
  fallbackLanguage: string,
): MessageTable[] {
  const bare = language.split(/[-_]/)[0] as string;
  const order = [language, bare, fallbackLanguage];
  const chain: MessageTable[] = [];
  const seen = new Set<MessageTable>();
  for (const lang of order) {
    const table = resources[lang];
    if (table && !seen.has(table)) {
      seen.add(table);
      chain.push(table);
    }
  }
  return chain;
}

/** Builds a Translations lookup — pure over its config (closes over the
 *  resources), so re-creating it for a new `language` is cheap; do that when
 *  the device language resolves. Wire never sees any of this. */
export function createTranslations(config: TranslationConfig): Translations {
  const language = config.language ?? config.fallbackLanguage;
  const pluralRule = config.pluralRule ?? englishPluralRule;
  const chain = tableChain(config.resources, language, config.fallbackLanguage);

  return {
    language,
    t(key, params) {
      const message = chain
        .map((table) => table[key])
        .find((m) => m !== undefined);
      if (message === undefined) return key; // untranslated marker
      if (typeof message === "string") return interpolate(message, params);
      // Plural bundle: pick the category for the count, falling back to
      // `other` when the selected category isn't provided (or count is absent).
      const count = params?.count;
      const category =
        count === undefined ? "other" : pluralRule(language, count);
      const form = message[category] ?? message.other;
      return interpolate(form, params);
    },
  };
}

const TranslationContext = createContext<Translations>(
  createTranslations({ resources: {}, fallbackLanguage: "en" }),
);

/** Provides translations to the subtree — build them with `createTranslations`
 *  and re-create when the device language changes. */
export function TranslationProvider(props: {
  translations: Translations;
  children?: ReactNode;
}): ReactNode {
  return createElement(
    TranslationContext.Provider,
    { value: props.translations },
    props.children,
  );
}

/** The nearest provided translations (an empty en set when none is). */
export function useTranslation(): Translations {
  return useContext(TranslationContext);
}
