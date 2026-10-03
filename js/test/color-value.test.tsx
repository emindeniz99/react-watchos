import { describe, expect, it } from "vitest";
import { MemoryHost, Text, VStack, WatchRoot } from "../src/index";
import { findByType } from "./helpers";

// ColorValue typing (design-theme-2026-07-05: Restyle's typed-token idea): a
// color prop accepts a SwiftUI system color NAME or a "#hex" string, and a
// misspelled name is a COMPILE error. The @ts-expect-error guards below lock
// that in — if the prop type is ever loosened back to plain `string`, the
// expect-error lines become unused and `tsc` (pnpm typecheck) fails. Pure
// types: the wire still carries a plain string, so there's no runtime cost.

describe("ColorValue prop typing", () => {
  it("accepts a system color name and a #hex string", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack background="#1c1c1e">
        <Text color="secondary">a</Text>
        <Text color="#ff0000">b</Text>
      </VStack>,
    );
    const texts = findByType(host.lastCommit!.root!, "Text");
    expect(texts[0]?.props.color).toBe("secondary");
    expect(texts[1]?.props.color).toBe("#ff0000");
  });

  it("rejects a misspelled name / non-hex string at compile time", () => {
    // @ts-expect-error "secondari" is not a SystemColorName and not "#..."
    const typo = <Text color="secondari">x</Text>;
    // @ts-expect-error a bare non-hex CSS-ish name is not a ColorValue
    const notAName = <VStack background="tomato" />;
    expect(typo).toBeTruthy();
    expect(notAName).toBeTruthy();
  });
});

// Fill: `background`/`containerBackground` take a colour OR a gradient object.
// The serializer forwards the object untouched (RNStyle.fill parses it in
// Swift), and the string form keeps its plain-string wire shape.
describe("Fill prop typing and serialization", () => {
  it("serializes a gradient object as-is and a colour as a string", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <VStack>
        <VStack
          background={{ type: "linearGradient", colors: ["red", "blue"] }}
        />
        <VStack background="#1c1c1e" containerBackground="indigo" />
      </VStack>,
    );
    const [, gradient, solid] = findByType(host.lastCommit!.root!, "VStack");
    expect(gradient?.props.background).toEqual({
      type: "linearGradient",
      colors: ["red", "blue"],
    });
    expect(solid?.props.background).toBe("#1c1c1e");
    expect(solid?.props.containerBackground).toBe("indigo");
  });

  it("rejects an untagged gradient and a misspelled stop colour", () => {
    // @ts-expect-error a gradient needs its `type` discriminator
    const untagged = <VStack background={{ colors: ["red", "blue"] }} />;
    const typo = (
      <VStack
        background={{
          type: "linearGradient",
          // @ts-expect-error "tomato" is not a ColorValue
          stops: [{ color: "tomato", location: 0 }],
        }}
      />
    );
    expect(untagged).toBeTruthy();
    expect(typo).toBeTruthy();
  });
});
