import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { VStackProps } from "../src/index";
import {
  Button,
  HStack,
  Image,
  MemoryHost,
  Spacer,
  Text,
  Toggle,
  VStack,
  WatchRoot,
} from "../src/index";
import { findByType } from "./helpers";

describe("render", () => {
  it("serializes a JSX tree to the exact wire schema", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack spacing={8}>
        <Text bold size={20}>
          Hello
        </Text>
        <Image systemName="heart.fill" color="red" />
        <Spacer />
      </VStack>,
    );

    expect(host.commits).toHaveLength(1);
    expect(host.lastCommit).toEqual({
      v: 1,
      seq: 0,
      root: {
        id: 4,
        type: "VStack",
        props: { spacing: 8 },
        children: [
          {
            id: 1,
            type: "Text",
            props: { bold: true, size: 20, text: "Hello" },
            children: [],
          },
          {
            id: 2,
            type: "Image",
            props: { systemName: "heart.fill", color: "red" },
            children: [],
          },
          { id: 3, type: "Spacer", props: {}, children: [] },
        ],
      },
    });
  });

  it("folds mixed text children into props.text", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(<Text>Count: {3}</Text>);
    expect(host.lastCommit?.root?.props.text).toBe("Count: 3");
  });

  it("reordering a keyed child to last doesn't duplicate it (appendChild move)", () => {
    // react-reconciler moves a keyed child to the LAST slot via appendChild
    // with no preceding removeChild; a plain push would leave the node in
    // twice (duplicate wire ids). This pins the move semantics.
    function List({ order }: { order: string[] }) {
      return (
        <VStack>
          {order.map((k) => (
            <Text key={k}>{k}</Text>
          ))}
        </VStack>
      );
    }
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<List order={["a", "b", "c"]} />);
    root.render(<List order={["b", "c", "a"]} />); // "a" moves to last
    const texts = host.lastCommit!.root!.children;
    expect(texts.map((t) => t.props.text)).toEqual(["b", "c", "a"]);
    const ids = texts.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("reordering a keyed child to front/middle doesn't duplicate it (insertBefore move)", () => {
    // The complementary path (2026-07-04 review §5.7): moving a keyed child
    // FORWARD goes through insertBefore, not appendChild — a splice that
    // forgot to remove the old position would leave the node in twice.
    function List({ order }: { order: string[] }) {
      return (
        <VStack>
          {order.map((k) => (
            <Text key={k}>{k}</Text>
          ))}
        </VStack>
      );
    }
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<List order={["a", "b", "c"]} />);
    root.render(<List order={["c", "a", "b"]} />); // "c" moves to FRONT
    let texts = host.lastCommit!.root!.children;
    expect(texts.map((t) => t.props.text)).toEqual(["c", "a", "b"]);
    expect(new Set(texts.map((t) => t.id)).size).toBe(texts.length);

    root.render(<List order={["c", "b", "a"]} />); // "b" moves to MIDDLE
    texts = host.lastCommit!.root!.children;
    expect(texts.map((t) => t.props.text)).toEqual(["c", "b", "a"]);
    expect(new Set(texts.map((t) => t.id)).size).toBe(texts.length);
  });

  it("serializes a Dynamic Type textStyle", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(<Text textStyle="headline">Title</Text>);
    expect(host.lastCommit?.root?.props).toMatchObject({
      text: "Title",
      textStyle: "headline",
    });
  });

  it("replaces function props with true flags so Swift sees interactivity", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <HStack>
        <Button onPress={() => {}}>
          <Text>Tap</Text>
        </Button>
        <Toggle value={false} onChange={() => {}} label="Wifi" />
      </HStack>,
    );
    const [button, toggle] = host.lastCommit!.root!.children;
    expect(button.props).toEqual({ onPress: true });
    expect(toggle.props).toEqual({
      value: false,
      onChange: true,
      label: "Wifi",
    });
  });

  it("produces only plist/JSON-safe prop values", () => {
    const host = new MemoryHost();
    // spacing is explicitly undefined to prove the serializer drops
    // undefined-valued props (the assertions below require every value to
    // be a JSON scalar). exactOptionalPropertyTypes rejects an inline
    // `spacing={undefined}`, so pass it through a deliberately-cast spread.
    const undefinedSpacing = { spacing: undefined } as unknown as VStackProps;
    new WatchRoot(host).render(
      <VStack {...undefinedSpacing}>
        <Button onPress={() => {}}>
          <Text color="green">ok</Text>
        </Button>
      </VStack>,
    );
    const checkScalarOrArray = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(checkScalarOrArray);
        return;
      }
      expect(["string", "number", "boolean"]).toContain(typeof value);
    };
    const check = (node: {
      props: Record<string, unknown>;
      children: { props: Record<string, unknown>; children: unknown[] }[];
    }): void => {
      Object.values(node.props).forEach(checkScalarOrArray);
      node.children.forEach((child) => {
        check(child as never);
      });
    };
    check(host.lastCommit!.root! as never);
  });

  it("throws on raw text outside <Text>", () => {
    const host = new MemoryHost();
    expect(() => new WatchRoot(host).render(<VStack>oops</VStack>)).toThrow(
      /wrapped in a <Text>/,
    );
  });

  it("throws on multiple root nodes instead of dropping siblings", () => {
    // The watch host renders exactly one root view, so a fragment with two
    // top-level children has no single root. The old serializer kept
    // children[0] and silently dropped the rest; this must fail loud so the
    // missing UI is a build-time error, not an invisible bug on the wrist.
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    expect(() =>
      root.render(
        <>
          <Text>one</Text>
          <Text>two</Text>
        </>,
      ),
    ).toThrow(/single root element \(got 2\)/i);
    expect(host.commits).toHaveLength(0);
  });
});

describe("wire-identical commit skip (NF-21)", () => {
  it("skips serialization entirely when a commit changes nothing wire-visible", () => {
    // State changes 0.4 → 0.45, but the rendered text rounds to "0" both
    // times: React commits (new props identity), yet the wire bytes would be
    // identical — the serializer must not even run.
    function Rounded() {
      const [v, setV] = useState(0.4);
      return (
        <Button onPress={() => setV(0.45)}>
          <Text>{Math.round(v)}</Text>
        </Button>
      );
    }
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Rounded />);
    const button = findByType(host.lastCommit!.root!, "Button")[0];
    const commitsBefore = host.commits.length;

    const stringify = vi.spyOn(JSON, "stringify");
    try {
      // No seq → no ack owed, so the clean tree short-circuits before
      // serializeTree/JSON.stringify.
      root.dispatchEvent({ nodeId: button.id, event: "press" });
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
    expect(host.commits.length).toBe(commitsBefore);
  });

  it("still acks the seq when the tree is wire-identical", () => {
    function Rounded() {
      const [v, setV] = useState(0.4);
      return (
        <Button onPress={() => setV(0.45)}>
          <Text>{Math.round(v)}</Text>
        </Button>
      );
    }
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Rounded />);
    const button = findByType(host.lastCommit!.root!, "Button")[0];

    root.dispatchEvent({ nodeId: button.id, event: "press", seq: 7 });
    // The ack forces a serialize even on a clean tree (CX-010): the commit
    // carrying seq 7 must reach native or an optimistic control strands.
    expect(host.lastCommit!.seq).toBe(7);
  });

  it("a real value change still commits", () => {
    function Counter() {
      const [n, setN] = useState(0);
      return (
        <Button onPress={() => setN((c) => c + 1)}>
          <Text>{n}</Text>
        </Button>
      );
    }
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Counter />);
    const button = findByType(host.lastCommit!.root!, "Button")[0];
    root.dispatchEvent({ nodeId: button.id, event: "press" });
    const text = findByType(host.lastCommit!.root!, "Text")[0];
    expect(text.props.text).toBe("1");
  });
});
