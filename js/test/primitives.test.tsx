import { describe, expect, it } from "vitest";
import {
  Divider,
  Gauge,
  List,
  MemoryHost,
  NavigationLink,
  NavigationStack,
  ProgressView,
  ScrollView,
  Text,
  VStack,
  WatchRoot,
  ZStack,
  type SerializedNode,
} from "../src/index";

function render(element: React.ReactNode): SerializedNode {
  const host = new MemoryHost();
  new WatchRoot(host).render(element);
  return host.lastCommit!.root!;
}

describe("container primitives", () => {
  it("serializes ZStack, ScrollView and List with their children", () => {
    const root = render(
      <ZStack>
        <ScrollView>
          <List>
            <Text>row 1</Text>
            <Text>row 2</Text>
          </List>
        </ScrollView>
      </ZStack>,
    );
    expect(root.type).toBe("ZStack");
    expect(root.children[0].type).toBe("ScrollView");
    const list = root.children[0].children[0];
    expect(list.type).toBe("List");
    expect(list.children.map((c) => c.props.text)).toEqual(["row 1", "row 2"]);
  });

  it("serializes Divider with no props", () => {
    const root = render(
      <VStack>
        <Divider />
      </VStack>,
    );
    expect(root.children[0]).toEqual({
      id: root.children[0].id,
      type: "Divider",
      props: {},
      children: [],
    });
  });
});

describe("data display primitives", () => {
  it("serializes Gauge with value range, label and style", () => {
    const root = render(
      <Gauge value={3} min={0} max={8} label="Water" style="circular" />,
    );
    expect(root).toMatchObject({
      type: "Gauge",
      props: { value: 3, min: 0, max: 8, label: "Water", style: "circular" },
    });
  });

  it("serializes ProgressView with value and total", () => {
    const root = render(<ProgressView value={3} total={8} label="Goal" />);
    expect(root).toMatchObject({
      type: "ProgressView",
      props: { value: 3, total: 8, label: "Goal" },
    });
  });
});

describe("navigation primitives", () => {
  it("serializes NavigationLink with its destination as children", () => {
    const root = render(
      <NavigationStack title="Demos">
        <List>
          <NavigationLink title="Details">
            <VStack>
              <Text>detail screen</Text>
            </VStack>
          </NavigationLink>
        </List>
      </NavigationStack>,
    );
    expect(root.type).toBe("NavigationStack");
    expect(root.props.title).toBe("Demos");
    const link = root.children[0].children[0];
    expect(link.type).toBe("NavigationLink");
    expect(link.props.title).toBe("Details");
    // The destination is part of the committed tree, so taps inside it
    // can be dispatched by node id like everything else.
    expect(link.children[0].children[0].props.text).toBe("detail screen");
  });
});
