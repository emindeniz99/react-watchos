import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  Button,
  MemoryHost,
  Text,
  VStack,
  WatchRoot,
  type SerializedNode,
} from "../src/index";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <VStack>
      <Text>Count: {count}</Text>
      <Button onPress={() => setCount((c) => c + 1)}>
        <Text>+1</Text>
      </Button>
    </VStack>
  );
}

function findByType(node: SerializedNode, type: string): SerializedNode[] {
  return [
    ...(node.type === type ? [node] : []),
    ...node.children.flatMap((child) => findByType(child, type)),
  ];
}

describe("updates", () => {
  it("recommits the full tree with stable ids after setState", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Counter />);

    const before = host.lastCommit!.root!;
    const button = findByType(before, "Button")[0];
    expect(root.dispatchEvent({ nodeId: button.id, event: "press" })).toBe(
      true,
    );

    expect(host.commits.length).toBeGreaterThan(1);
    const after = host.lastCommit!.root!;
    expect(findByType(after, "Text")[0].props.text).toBe("Count: 1");
    // Unchanged host elements keep their ids across commits.
    expect(after.id).toBe(before.id);
    expect(findByType(after, "Button")[0].id).toBe(button.id);
  });

  it("drops removed subtrees from the committed tree", () => {
    function Shrinking() {
      const [on, setOn] = useState(true);
      return (
        <VStack>
          {on ? <Text>visible</Text> : null}
          <Button onPress={() => setOn(false)}>
            <Text>hide</Text>
          </Button>
        </VStack>
      );
    }
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Shrinking />);

    const button = findByType(host.lastCommit!.root!, "Button")[0];
    root.dispatchEvent({ nodeId: button.id, event: "press" });

    const texts = findByType(host.lastCommit!.root!, "Text");
    expect(texts.map((t) => t.props.text)).toEqual(["hide"]);
  });

  it("commits null root on unmount", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Text>bye</Text>);
    root.unmount();
    expect(host.lastCommit).toEqual({ v: 1, root: null });
  });
});
