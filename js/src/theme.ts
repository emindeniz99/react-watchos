import type { ReactNode } from "react";
import { createContext, createElement, useContext } from "react";
import type { ColorValue, TextProps } from "./components";

/**
 * Design-system Tier 2: semantic tokens, resolved in JS (2026-07-01 review
 * §2.4). The watch is always-dark, so the theme axis is tint/semantics, not
 * light/dark. Everything here is plain data + one context — resolution
 * happens where you render (`useTheme()`), the wire and the Swift
 * interpreter never see tokens, and the layer is fully testable off-device.
 *
 * Host primitives are string-typed (no wrapper components run per node), so
 * tokens are consumed explicitly rather than via magic prop values:
 *
 *   const t = useTheme();
 *   <VStack spacing={t.space.sm} padding={t.space.md}
 *           background={t.colors.surface} cornerRadius={t.radius.md}>
 *     <Text {...t.text.title}>Water</Text>
 *     <Text {...t.text.muted}>2 of 8 glasses</Text>
 *   </VStack>
 *
 * `t.text.*` are spreadable Text prop bundles (variants); Dynamic Type comes
 * free because they resolve to `textStyle`, never fixed point sizes.
 */

/** Spreadable Text prop bundle — a text "variant". */
export type TextVariant = Pick<
  TextProps,
  "textStyle" | "bold" | "color" | "monospacedDigit"
>;

export interface WatchTheme {
  /** Spacing scale (points) for spacing/padding. */
  space: { xs: number; sm: number; md: number; lg: number; xl: number };
  /** Corner-radius scale (points). */
  radius: { sm: number; md: number; lg: number };
  /**
   * Semantic colors (system color names or #RRGGBB[AA] hex — anything the
   * `color`/`background`/`tint` props accept). Prefer the semantic names so
   * screens stay consistent when the accent changes.
   */
  colors: {
    /** App accent — buttons, gauges, links. */
    accent: ColorValue;
    /** Card/section fill behind content. */
    surface: ColorValue;
    /** De-emphasized text. */
    muted: ColorValue;
    /** Positive state (goal reached, connected). */
    positive: ColorValue;
    /** Warning state (low battery, degraded). */
    warning: ColorValue;
    /** Destructive/error state. */
    destructive: ColorValue;
  };
  /** Text variants — spread onto <Text>: `<Text {...theme.text.title}>`. */
  text: {
    title: TextVariant;
    headline: TextVariant;
    body: TextVariant;
    caption: TextVariant;
    muted: TextVariant;
    /** Fixed-width digits for counters/timers (no layout jitter). */
    numeric: TextVariant;
  };
}

/**
 * The stock watch theme: SwiftUI semantic colors + Dynamic-Type text styles,
 * so the defaults look native with zero configuration.
 */
export const defaultTheme: WatchTheme = {
  space: { xs: 2, sm: 4, md: 8, lg: 12, xl: 16 },
  radius: { sm: 4, md: 8, lg: 12 },
  colors: {
    accent: "accentColor",
    surface: "#1c1c1e",
    muted: "secondary",
    positive: "green",
    warning: "orange",
    destructive: "red",
  },
  text: {
    title: { textStyle: "title3", bold: true },
    headline: { textStyle: "headline" },
    body: { textStyle: "body" },
    caption: { textStyle: "caption" },
    muted: { textStyle: "footnote", color: "secondary" },
    numeric: { textStyle: "body", monospacedDigit: true },
  },
};

/** Deep partial of WatchTheme for createTheme overrides. */
export type ThemeOverrides = {
  [K in keyof WatchTheme]?: Partial<WatchTheme[K]>;
};

/**
 * A theme = the default with your overrides merged one level deep per
 * section — override `colors.accent` without restating the rest.
 */
export function createTheme(overrides: ThemeOverrides = {}): WatchTheme {
  return {
    space: { ...defaultTheme.space, ...overrides.space },
    radius: { ...defaultTheme.radius, ...overrides.radius },
    colors: { ...defaultTheme.colors, ...overrides.colors },
    // Text values are themselves prop bundles, so merge one level DEEPER than
    // the scalar sections: a partial variant override (e.g. `{ numeric: { color
    // } }`) must keep the variant's other props (numeric's monospacedDigit /
    // textStyle), not replace the whole bundle.
    text: mergeTextVariants(defaultTheme.text, overrides.text),
  };
}

function mergeTextVariants(
  base: WatchTheme["text"],
  over: Partial<WatchTheme["text"]> = {},
): WatchTheme["text"] {
  const out = {} as WatchTheme["text"];
  for (const key of Object.keys(base) as (keyof WatchTheme["text"])[]) {
    out[key] = { ...base[key], ...over[key] };
  }
  return out;
}

const ThemeContext = createContext<WatchTheme>(defaultTheme);

/** Provides a theme to the subtree; omit entirely to use the default. */
export function ThemeProvider(props: {
  theme: WatchTheme;
  children?: ReactNode;
}): ReactNode {
  return createElement(
    ThemeContext.Provider,
    { value: props.theme },
    props.children,
  );
}

/** The nearest provided theme (the stock `defaultTheme` when none is). */
export function useTheme(): WatchTheme {
  return useContext(ThemeContext);
}
