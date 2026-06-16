import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button, MemoryHost, Text, VStack, WatchRoot } from "../src/index";
import { findByType } from "./helpers";

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
    expect(host.lastCommit).toEqual({ v: 1, seq: 0, root: null });
  });

  it("acks the dispatched seq on the resulting commit", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Counter />);
    expect(host.lastCommit!.seq).toBe(0);

    const button = findByType(host.lastCommit!.root!, "Button")[0];
    root.dispatchEvent({ nodeId: button.id, event: "press", seq: 7 });
    expect(host.lastCommit!.seq).toBe(7);
    // Later commits keep acking the latest processed seq.
    root.dispatchEvent({ nodeId: button.id, event: "press", seq: 8 });
    expect(host.lastCommit!.seq).toBe(8);
  });

  it("acks a seq even when the handler causes no re-render", () => {
    const noop = () => {};
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <Button onPress={noop}>
        <Text>inert</Text>
      </Button>,
    );
    const commitsBefore = host.commits.length;
    const button = host.lastCommit!.root!;
    root.dispatchEvent({ nodeId: button.id, event: "press", seq: 3 });
    // No state change, but native still gets an ack commit so its
    // optimistic controls can release their local values.
    expect(host.commits.length).toBe(commitsBefore + 1);
    expect(host.lastCommit!.seq).toBe(3);
  });

  it("skips a no-op commit when the re-rendered tree is unchanged", () => {
    function Stable() {
      const [, bump] = useState(0);
      return (
        <Button onPress={() => bump((n) => n + 1)}>
          <Text>same</Text>
        </Button>
      );
    }
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Stable />);
    const before = host.commits.length;
    const button = findByType(host.lastCommit!.root!, "Button")[0];

    // State changes (React commits) but the serialized tree is identical
    // and no seq is carried, so the bailout suppresses the native push.
    root.dispatchEvent({ nodeId: button.id, event: "press" });
    expect(host.commits.length).toBe(before);
  });

  it("commits again once the rendered output actually changes", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Text>a</Text>);
    expect(host.commits).toHaveLength(1);
    root.render(<Text>a</Text>);
    expect(host.commits).toHaveLength(1); // identical → skipped
    root.render(<Text>b</Text>);
    expect(host.commits).toHaveLength(2); // changed → sent
  });
});
