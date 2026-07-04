// `plurals-cldr` (nodeca) ships no types. It's a zero-Intl CLDR cardinal/ordinal
// plural-category table — a function keyed by locale + count. Used by
// `cldrPluralRule` in i18n.tsx; typed to our PluralCategory-shaped strings.
declare module "plurals-cldr" {
  type CldrCategory = "zero" | "one" | "two" | "few" | "many" | "other";
  /** Cardinal category for `count` in `locale`, or null for an unknown locale. */
  function plural(locale: string, count: number): CldrCategory | null;
  namespace plural {
    /** Ordinal category (1st/2nd/3rd…), same null-on-unknown behavior. */
    function ordinal(locale: string, count: number): CldrCategory | null;
  }
  export default plural;
}
