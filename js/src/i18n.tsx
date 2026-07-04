import pluralsCldr from "plurals-cldr";
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
 *
 * Design, after comparing against react-i18next / FormatJS / Lingui (all of
 * which hard-depend on `Intl.PluralRules` and so can't run here anyway):
 * - `{name}` interpolation follows the ICU/FormatJS single-brace convention
 *   (i18next uses `{{name}}`); a `{token}` whose name isn't `\w+` (e.g. `{50%}`)
 *   passes through literally.
 * - Plurals are nested-object bundles (`{ one, other }`), NOT ICU inline
 *   strings (`{n, plural, …}`) — that would need a runtime ICU parser or a
 *   build step, and re-couples `#` to `Intl.NumberFormat`. Category selection
 *   is the injected `PluralRule`; the batteries default to English one/other,
 *   with `cldrPluralRule` the opt-in for full CLDR correctness.
 * - Deliberately OMITTED (Rule 2 / this target): namespaces (i18next's
 *   lazy `ns:key` split — pointless for one in-bundle table), HTML escaping
 *   (output goes to SwiftUI `Text`, not a DOM — escaping would corrupt copy),
 *   and non-string returns (`returnObjects`) — prefer N keys over overloading
 *   `t()`. A missing key returns the key itself (a visible dev marker).
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
 *  `Intl.PluralRules`, so the rule is a plain function — inject `cldrPluralRule`
 *  (canonical, all languages) or your own. */
export type PluralRule = (language: string, count: number) => PluralCategory;

/**
 * The zero-dependency DEFAULT — English/Germanic `one`/`other` only. Correct
 * for en/de/nl/… and any two-form cardinal, but WRONG for Arabic, the Slavic
 * languages (few/many), etc. It's the default because most watch apps are
 * single-language and we keep the base bundle lean (no CLDR data unless asked).
 *
 * **If your app targets a language with richer plurals, pass
 * `cldrPluralRule`** (or your own `PluralRule`) so `few`/`many`/`two`/`zero`
 * resolve correctly — the English default would silently pick `other`.
 */
export const englishPluralRule: PluralRule = (_language, count) =>
  count === 1 ? "one" : "other";

/**
 * Canonical CLDR cardinal rule for ALL ~220 languages, backed by
 * `plurals-cldr` (nodeca) — a ~2.7 KB gz, zero-`Intl` data table, the same
 * CLDR source the big i18n libraries' build tools use. Opt in when you need
 * correct plurals beyond English one/other:
 *
 *   createTranslations({ resources, fallbackLanguage: "en",
 *                        language: deviceLanguage, pluralRule: cldrPluralRule })
 *
 * We deliberately keep this OFF the default path so an English-only app pays
 * nothing for the table (bundle discipline); it tree-shakes out unless
 * imported. An unknown language falls back to the English rule.
 */
export const cldrPluralRule: PluralRule = (language, count) =>
  (pluralsCldr(language, count) as PluralCategory | null) ??
  englishPluralRule(language, count);

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
