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

  it("nests rich text >=2 deep as a nested child tree (each interpreter must fold recursively)", () => {
    // The wire the Swift interpreters consume: a segment that itself contains a
    // <Text> is text="" with its content as CHILD nodes, recursively. The app
    // interpreter folds this recursively; the widget interpreter once did not,
    // so ">=2 deep" rich text dropped its deepest text on the complication only.
    // This pins the nested shape both sides depend on (its Swift companion is
    // the textSegment-recursion guard in interpreter-prop-parity.test.ts).
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <Text>
        a
        <Text bold>
          b<Text color="cyan">c</Text>
        </Text>
      </Text>,
    );
    const outer = findByType(host.lastCommit!.root!, "Text")[0];
    // Level 0: element children -> text folds out, "a" + the middle segment.
    expect(outer.props.text).toBe("");
    expect(outer.children.map((c) => c.props.text)).toEqual(["a", ""]);
    // Level 1: the middle segment ALSO has an element child, so it too is
    // text="" and carries "b" + the inner <Text>c</Text> as its own children.
    const middle = outer.children[1];
    expect(middle.props.bold).toBe(true);
    expect(middle.props.text).toBe("");
    expect(middle.children.map((c) => c.props.text)).toEqual(["b", "c"]);
    // Level 2: the deepest segment carries its own style, so folding must reach
    // it (the exact node the widget used to drop).
    expect(middle.children[1].props.color).toBe("cyan");
  });

  it("scalar-only Text keeps the folded wire shape (no children)", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Text>plain {42}</Text>);
    const text = findByType(host.lastCommit!.root!, "Text")[0];
    expect(text.props.text).toBe("plain 42");
    expect(text.children).toEqual([]);
  });

  it("folds boolean children to nothing (React semantics), not 'false'", () => {
    // The idiomatic `{cond && "…"}` guard yields `false` when off; React renders
    // booleans/null/undefined as nothing, so the wire text must be empty — not
    // the literal word "false" showing up on the watch.
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    const show = false;
    root.render(
      <Text>
        Total: {show && "loading"} {42}
      </Text>,
    );
    const text = findByType(host.lastCommit!.root!, "Text")[0];
    expect(text.props.text).toBe("Total:  42");
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
