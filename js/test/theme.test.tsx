import { describe, expect, it } from "vitest";
import {
  Button,
  createTheme,
  defaultTheme,
  MemoryHost,
  Text,
  ThemeProvider,
  useTheme,
  VStack,
  WatchRoot,
} from "../src/index";
import { findByType } from "./helpers";

// Design-system Tier 2 (2026-07-01 review §2.4): tokens resolve in JS at
// render — the wire carries only concrete values, so the Swift interpreter
// never sees a token and the whole layer is testable here.

function Card() {
  const t = useTheme();
  return (
    <VStack
      spacing={t.space.sm}
      padding={t.space.md}
      background={t.colors.surface}
      cornerRadius={t.radius.md}
      tint={t.colors.accent}
    >
      <Text {...t.text.title}>Water</Text>
      <Text {...t.text.muted}>2 of 8</Text>
      <Button onPress={() => {}}>
        <Text {...t.text.numeric}>+1</Text>
      </Button>
    </VStack>
  );
}

describe("theme tokens (Tier 2)", () => {
  it("renders default-theme tokens as concrete wire values", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Card />);
    const node = host.lastCommit!.root!;
    expect(node.props).toMatchObject({
      spacing: defaultTheme.space.sm,
      padding: defaultTheme.space.md,
      background: defaultTheme.colors.surface,
      cornerRadius: defaultTheme.radius.md,
      tint: defaultTheme.colors.accent,
    });
    const texts = findByType(node, "Text");
    expect(texts[0].props).toMatchObject({ textStyle: "title3", bold: true });
    expect(texts[1].props).toMatchObject({
      textStyle: "footnote",
      color: "secondary",
    });
    expect(texts[2].props).toMatchObject({ monospacedDigit: true });
    // No token names ever reach the wire.
    expect(JSON.stringify(node)).not.toContain('"md"');
  });

  it("ThemeProvider overrides flow to the subtree", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    const theme = createTheme({
      colors: { accent: "cyan" },
      space: { md: 10 },
      text: { title: { textStyle: "headline", bold: false } },
    });
    root.render(
      <ThemeProvider theme={theme}>
        <Card />
      </ThemeProvider>,
    );
    const node = host.lastCommit!.root!;
    expect(node.props.tint).toBe("cyan");
    expect(node.props.padding).toBe(10);
    // Untouched sections keep the defaults.
    expect(node.props.background).toBe(defaultTheme.colors.surface);
    const title = findByType(node, "Text")[0];
    expect(title.props.textStyle).toBe("headline");
    // Explicit `bold: false` in the override crosses the wire as false
    // (only `undefined` props are dropped); the interpreter treats it as
    // not-bold either way.
    expect(title.props.bold).toBe(false);
  });

  it("createTheme merges one level deep without mutating the default", () => {
    const before = JSON.stringify(defaultTheme);
    const theme = createTheme({ colors: { accent: "#ff00ff" } });
    expect(theme.colors.accent).toBe("#ff00ff");
    expect(theme.colors.positive).toBe(defaultTheme.colors.positive);
    expect(JSON.stringify(defaultTheme)).toBe(before);
  });

  it("createTheme merges a partial text variant, keeping its other props", () => {
    // Overriding only numeric's color must preserve monospacedDigit + textStyle
    // — else a numeric label silently loses its fixed-width digits (the reason
    // the variant exists).
    const theme = createTheme({ text: { numeric: { color: "green" } } });
    expect(theme.text.numeric.color).toBe("green");
    expect(theme.text.numeric.monospacedDigit).toBe(
      defaultTheme.text.numeric.monospacedDigit,
    );
    expect(theme.text.numeric.textStyle).toBe(
      defaultTheme.text.numeric.textStyle,
    );
  });
});
