import { describe, expect, it } from "vitest";
import {
  Button,
  Image,
  MemoryHost,
  Text,
  VStack,
  WatchRoot,
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
});
