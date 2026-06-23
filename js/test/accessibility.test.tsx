import { describe, expect, it } from "vitest";
import {
  Button,
  Divider,
  Image,
  List,
  MemoryHost,
  NavigationLink,
  NavigationRoute,
  NavigationStack,
  ScrollView,
  Spacer,
  TabView,
  Text,
  VStack,
  WatchRoot,
  ZStack,
} from "../src/index";

describe("accessibility props", () => {
  it("serializes accessibilityLabel and accessibilityHint into props", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <Button
        accessibilityLabel="Add glass"
        accessibilityHint="Logs one glass of water"
        onPress={() => {}}
      >
        <Image systemName="drop.fill" />
      </Button>,
    );
    expect(host.lastCommit!.root!.props).toMatchObject({
      onPress: true,
      accessibilityLabel: "Add glass",
      accessibilityHint: "Logs one glass of water",
    });
  });

  it("omits a11y props when not provided", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <VStack>
        <Text>plain</Text>
      </VStack>,
    );
    const text = host.lastCommit!.root!.children[0];
    expect(text.props).not.toHaveProperty("accessibilityLabel");
    expect(text.props).not.toHaveProperty("accessibilityHint");
  });

  it("serializes a11y props on structural primitives", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <VStack accessibilityLabel="root">
        <ZStack accessibilityLabel="overlay">
          <ScrollView accessibilityHint="Scroll demos">
            <List accessibilityLabel="Demo list">
              <NavigationStack accessibilityLabel="Navigation root">
                <NavigationRoute path="/" accessibilityLabel="Home route">
                  <NavigationLink
                    to="/details"
                    label="Details"
                    accessibilityHint="Opens details"
                  />
                </NavigationRoute>
              </NavigationStack>
            </List>
          </ScrollView>
        </ZStack>
        <TabView accessibilityLabel="Pages">
          <Text>page</Text>
        </TabView>
        <Divider accessibilityLabel="Separator" />
        <Spacer accessibilityLabel="Flexible space" />
      </VStack>,
    );

    const root = host.lastCommit!.root!;
    expect(root.props.accessibilityLabel).toBe("root");
    const zstack = root.children[0];
    expect(zstack.props.accessibilityLabel).toBe("overlay");
    const scroll = zstack.children[0];
    expect(scroll.props.accessibilityHint).toBe("Scroll demos");
    const list = scroll.children[0];
    expect(list.props.accessibilityLabel).toBe("Demo list");
    const nav = list.children[0];
    expect(nav.props.accessibilityLabel).toBe("Navigation root");
    expect(nav.children[0].props.accessibilityLabel).toBe("Home route");
    expect(nav.children[0].children[0].props.accessibilityHint).toBe(
      "Opens details",
    );
    expect(root.children[1].props.accessibilityLabel).toBe("Pages");
    expect(root.children[2].props.accessibilityLabel).toBe("Separator");
    expect(root.children[3].props.accessibilityLabel).toBe("Flexible space");
  });
});
