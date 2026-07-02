import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button, MemoryHost, Text, VStack, WatchRoot } from "../src/index";
import { findByType } from "./helpers";

// Rich text: nested <Text> children become child nodes (one native Text via
// concatenation on the Swift side); scalar-only children keep folding into
// props.text, so the common case's wire shape is unchanged.

describe("rich text", () => {
  it("serializes nested Text segments as children with their own styles", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack>
        <Text textStyle="body">
          Drank <Text bold>3</Text> of <Text color="cyan">8</Text>
        </Text>
      </VStack>,
    );
    const outer = findByType(host.lastCommit!.root!, "Text")[0];
    // Element children present -> nothing folds into the outer text...
    expect(outer.props.text).toBe("");
    expect(outer.props.textStyle).toBe("body");
    // ...and every segment (raw strings included) is a Text child node.
    const segments = outer.children.map((c) => [c.props.text, c.props.bold]);
    expect(segments).toEqual([
      ["Drank ", undefined],
      ["3", true],
      [" of ", undefined],
      ["8", undefined],
    ]);
    expect(outer.children[3].props.color).toBe("cyan");
  });

  it("scalar-only Text keeps the folded wire shape (no children)", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Text>plain {42}</Text>);
    const text = findByType(host.lastCommit!.root!, "Text")[0];
    expect(text.props.text).toBe("plain 42");
    expect(text.children).toEqual([]);
  });

  it("updating a raw segment commits (commitTextUpdate marks dirty)", () => {
    function Counter() {
      const [n, setN] = useState(3);
      return (
        <VStack>
          <Button onPress={() => setN((c) => c + 1)}>
            <Text>tap</Text>
          </Button>
          <Text>
            Drank <Text bold>{n}</Text> today
          </Text>
        </VStack>
      );
    }
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Counter />);
    const button = findByType(host.lastCommit!.root!, "Button")[0];
    root.dispatchEvent({ nodeId: button.id, event: "press" });
    const outer = findByType(host.lastCommit!.root!, "Text").find(
      (t) => t.children.length > 0,
    );
    expect(outer?.children.map((c) => c.props.text)).toEqual([
      "Drank ",
      "4",
      " today",
    ]);
  });

  it("raw text outside <Text> still fails loud", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    expect(() =>
      root.render(<VStack>{"naked string" as never}</VStack>),
    ).toThrow(/wrapped in a <Text>/);
  });
});
