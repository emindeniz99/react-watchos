import { describe, expect, it } from "vitest";
import {
  cldrPluralRule,
  createTranslations,
  englishPluralRule,
  MemoryHost,
  type PluralRule,
  Text,
  TranslationProvider,
  useTranslation,
  VStack,
  WatchRoot,
} from "../src/index";
import { findByType } from "./helpers";

// i18n Tier 3 (M7 step 3): message translation resolves in JS at render —
// like theme tokens, the wire carries only the final string, so the Swift
// interpreter never sees a key and the whole layer is testable here.

const resources = {
  en: {
    hello: "Hi {name}",
    glasses: { one: "{count} glass", other: "{count} glasses" },
  },
  de: {
    hello: "Hallo {name}",
    glasses: { one: "{count} Glas", other: "{count} Gläser" },
    // `de` intentionally lacks `bye` to exercise the fallback chain.
  },
} as const;

function makeI18n(language: string, pluralRule?: PluralRule) {
  return createTranslations({
    resources: { ...resources, en: { ...resources.en, bye: "Bye" } },
    fallbackLanguage: "en",
    language,
    ...(pluralRule ? { pluralRule } : {}),
  });
}

describe("createTranslations", () => {
  it("interpolates placeholders in the active language", () => {
    expect(makeI18n("de").t("hello", { name: "Emin" })).toBe("Hallo Emin");
    expect(makeI18n("en").t("hello", { name: "Emin" })).toBe("Hi Emin");
  });

  it("selects a plural form by count (English one/other default)", () => {
    const de = makeI18n("de");
    expect(de.t("glasses", { count: 1 })).toBe("1 Glas");
    expect(de.t("glasses", { count: 2 })).toBe("2 Gläser");
    // A plural key with no count resolves to `other`.
    expect(de.t("glasses")).toBe("{count} Gläser");
  });

  it("resolves a full locale to its bare language prefix", () => {
    // getDeviceInfo() reports "de_DE"; resources are keyed by "de".
    expect(makeI18n("de_DE").t("hello", { name: "A" })).toBe("Hallo A");
    expect(makeI18n("en-GB").t("hello", { name: "A" })).toBe("Hi A");
  });

  it("falls back per key to the fallback language, then to the key itself", () => {
    // `bye` exists only in en; `de` active still finds it via the chain.
    expect(makeI18n("de").t("bye")).toBe("Bye");
    // A wholly unknown key returns the key — a visible untranslated marker.
    expect(makeI18n("de").t("nope")).toBe("nope");
  });

  it("uses an app-supplied plural rule for non-English languages", () => {
    // Polish-ish: 1 → one, 2–4 → few, else → many (abbreviated for the test).
    const plRule: PluralRule = (_lang, count) => {
      if (count === 1) return "one";
      if (count >= 2 && count <= 4) return "few";
      return "many";
    };
    const pl = createTranslations({
      resources: {
        pl: {
          apples: {
            one: "{count} jabłko",
            few: "{count} jabłka",
            many: "{count} jabłek",
            other: "{count} jabłka",
          },
        },
      },
      fallbackLanguage: "pl",
      language: "pl",
      pluralRule: plRule,
    });
    expect(pl.t("apples", { count: 1 })).toBe("1 jabłko");
    expect(pl.t("apples", { count: 3 })).toBe("3 jabłka");
    expect(pl.t("apples", { count: 12 })).toBe("12 jabłek");
  });

  it("defaults the active language to the fallback when omitted", () => {
    const i18n = createTranslations({ resources, fallbackLanguage: "en" });
    expect(i18n.language).toBe("en");
    expect(i18n.t("hello", { name: "X" })).toBe("Hi X");
  });

  it("englishPluralRule is the exported default", () => {
    expect(englishPluralRule("en", 1)).toBe("one");
    expect(englishPluralRule("en", 0)).toBe("other");
    expect(englishPluralRule("en", 5)).toBe("other");
  });

  it("cldrPluralRule gives canonical CLDR categories the English default can't", () => {
    // The concrete gap the English default silently gets wrong — verified via
    // plurals-cldr (no Intl). Arabic has all six categories; Slavic has few/many.
    expect(cldrPluralRule("ar", 0)).toBe("zero");
    expect(cldrPluralRule("ar", 2)).toBe("two");
    expect(cldrPluralRule("ar", 6)).toBe("few");
    expect(cldrPluralRule("ar", 15)).toBe("many");
    expect(cldrPluralRule("ru", 5)).toBe("many");
    expect(cldrPluralRule("ru", 21)).toBe("one");
    expect(cldrPluralRule("pl", 3)).toBe("few");
    // English still correct, and an unknown language falls back to English.
    expect(cldrPluralRule("en", 1)).toBe("one");
    expect(cldrPluralRule("xx", 2)).toBe("other");
  });

  it("wires cldrPluralRule through t() for a real Russian plural", () => {
    const ru = createTranslations({
      resources: {
        ru: {
          files: {
            one: "{count} файл",
            few: "{count} файла",
            many: "{count} файлов",
            other: "{count} файла",
          },
        },
      },
      fallbackLanguage: "ru",
      language: "ru",
      pluralRule: cldrPluralRule,
    });
    expect(ru.t("files", { count: 1 })).toBe("1 файл"); // one
    expect(ru.t("files", { count: 3 })).toBe("3 файла"); // few
    expect(ru.t("files", { count: 5 })).toBe("5 файлов"); // many
    expect(ru.t("files", { count: 21 })).toBe("21 файл"); // one (21 % 10 === 1)
  });
});

describe("TranslationProvider / useTranslation", () => {
  function Greeting() {
    const { t, language } = useTranslation();
    return (
      <VStack>
        <Text>{t("hello", { name: "Emin" })}</Text>
        <Text>{language}</Text>
      </VStack>
    );
  }

  it("resolves the translated string into the wire (no key crosses)", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <TranslationProvider translations={makeI18n("de")}>
        <Greeting />
      </TranslationProvider>,
    );
    const texts = findByType(host.lastCommit!.root!, "Text");
    expect(texts.map((n) => n.props.text)).toEqual(["Hallo Emin", "de"]);
  });

  it("re-renders in the new language when the provider value changes", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <TranslationProvider translations={makeI18n("en")}>
        <Greeting />
      </TranslationProvider>,
    );
    expect(findByType(host.lastCommit!.root!, "Text")[0]?.props.text).toBe(
      "Hi Emin",
    );
    root.render(
      <TranslationProvider translations={makeI18n("de")}>
        <Greeting />
      </TranslationProvider>,
    );
    expect(findByType(host.lastCommit!.root!, "Text")[0]?.props.text).toBe(
      "Hallo Emin",
    );
  });
});
