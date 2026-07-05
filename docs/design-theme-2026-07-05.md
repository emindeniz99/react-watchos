# Theme layer — prior-art pass & decisions (2026-07-05)

The theme layer ([`js/src/theme.ts`](../js/src/theme.ts), ~60 lines: a
`WatchTheme` of plain tokens, `createTheme(overrides)`, `ThemeProvider` /
`useTheme`) was designed first-principles. Per project rule 3 (research prior
art before hand-rolling — the lesson from the i18n layer), this is the
after-the-fact survey that should have preceded it, plus the decisions it drove.

## What we surveyed

Web/React design-token & theming libraries, RN-specific ones, the SwiftUI-native
approach, and the W3C design-token format — against our hard constraints:
QuickJS (no DOM, no CSS, no `Intl`), string-typed SwiftUI props (we pass
**concrete values**, not token names), ~200 KB budget, always-dark watchOS.

| Library / approach | Fit for us | Why |
|---|---|---|
| **Shopify Restyle** | **closest sibling** | runtime, 0 deps, ~15 KB; `createTheme` → plain object, `useTheme()` → `t.spacing.s`, shallow-merge overrides — nearly our exact API. Its **compile-time typed-token** pattern is the borrowable bit. |
| **theme-ui / System-UI spec** | model borrowable | the scale-key vocabulary + a ~5-line value-agnostic `get(theme, path)` resolver. But `get()` only helps if props take token *names*; we pass values, so it doesn't fit our consumption model. |
| **React Navigation theme** | validates ours | `{ dark, colors }` + `useTheme()` + shallow spread-merge — production proof that a tiny flat-object-in-one-context theme needs no machinery. |
| **Radix `@radix-ui/colors`** | idea for later | 12-step **semantic color roles** (steps carry intent: bg/hover/pressed, borders, solid, text). Over-engineered for an always-dark watch with a curated 6-color semantic set today. |
| vanilla-extract, Stitches, Tamagui, Panda, Radix Themes | **unusable** | all CSS/className/CSS-var-welded or wrap values in runtime `Variable` objects for a CSS optimization we don't have. Only their data models teach anything; their runtimes can't run in QuickJS and blow the budget. |
| dripsy, NativeWind, Unistyles (RN) | **unusable** | hard-bind to RN `StyleSheet`/`css-interop`/Nitro C++ and/or a mandatory Babel+Metro build. We emit SwiftUI props, not RN style objects. |
| **Style Dictionary** | out-of-band only | the token *build* tool; can emit plain JS + Swift from one source. Useful as an offline pipeline IF designers ever bring Figma tokens — not a runtime dependency. |
| **W3C DTCG** (design-token JSON) | **rejected** | 2025.10 is a Community-Group spec (not a W3C Rec) whose color `$value` is now a `{colorSpace, components, hex}` object, not a hex string — even Penpot/Tokens Studio mis-handle it. A ~13-type spec for a ~20-token hand-authored theme is overkill. |

## Decisions

1. **Keep it hand-rolled.** Every web lib is CSS-welded; our plain `WatchTheme` +
   `useTheme` + `createTheme(overrides)` is already the right architecture, and
   Restyle + React Navigation independently validate exactly that shape. No
   library beats it at our runtime.

2. **Do NOT push theme resolution native** (unlike `FormattedText`). The
   `FormattedText` analogy fails: it went native because QuickJS has **no
   `Intl`** — a real capability gap. Theme has none. And **watchOS is
   always-dark**, so "automatic dark mode" — the #1 reason to adopt the native
   asset-catalog path — buys nothing here; we already get the two native wins
   that matter (Dynamic Type scaling and accent-following) by shipping semantic
   *names* (`"accentColor"`, `"secondary"`, `textStyle` names) for exactly those
   token kinds, which the interpreter resolves. Going native would add a
   wire-protocol change, a second source of truth, and cost us JS testability —
   for a per-gamut/high-contrast asset-catalog variant almost nobody toggles on
   a watch. (Full SwiftUI/DTCG analysis in the research pass.)

3. **Do NOT build a DTCG importer** (see table). If Figma import is ever needed,
   run Style Dictionary out-of-band emitting our existing `WatchTheme` shape.

4. **ADOPTED — Restyle's typed-token idea, as `ColorValue`.** Color props
   (`color`/`background`/`tint`/`swipeActionTint`/…) and the theme's own
   `colors` were plain `string`. They are now
   [`ColorValue = SystemColorName | \`#${string}\``](../js/src/components.ts):
   the 18 SwiftUI semantic color names are **autocompleted**, and a misspelled
   name (`"secondari"`, `"tomato"`) is a **compile error**, while `#RRGGBB[AA]`
   hex still works. **Pure types — zero runtime bytes, no wire change, no OTA
   impact** (the interpreter still parses a plain string; a `.qbc`/OTA bundle is
   byte-for-byte unaffected because types are erased at build). `textStyle` was
   already a strict union, so it already had this; this closes the color gap.
   A `// @ts-expect-error` guard in `test/color-value.test.tsx` fails typecheck
   if the type is ever loosened back to `string`.

   Trade-off, chosen deliberately: a *computed* non-hex color (rare) now needs
   `as ColorValue` or a theme token. That friction is the price of catching the
   common name typo, and it's the right default for a watch where colors are
   almost always literals.

## Considered, not adopted (recorded so the choice is a decision)

- **`get(theme, path)` resolver (System-UI):** doesn't fit — we pass concrete
  values, not token names, so there's no path to resolve at the prop.
- **Radix 12-step semantic color roles:** over-engineering for an always-dark
  watch with a curated 6-color semantic set. On record as the idea to borrow
  *if* the palette ever needs interaction-state depth (bg/hover/pressed).
- **Full theme extensibility via `typeof theme` inference (a typed
  `createTheme`/`useTheme` factory):** speculative for a library whose value is
  a *curated* semantic set; it would trade simplicity for open-ended custom
  tokens nobody has asked for. Revisit only if consumers need brand tokens
  beyond overriding the existing slots (which `createTheme(overrides)` already
  allows).
