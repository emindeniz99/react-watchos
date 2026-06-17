import { describe, expect, it } from "vitest";
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
});
