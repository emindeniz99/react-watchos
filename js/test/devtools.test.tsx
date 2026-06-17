import { afterEach, describe, expect, it } from "vitest";
import { MemoryHost, runApp, Text, VStack } from "../src/index";

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__inspect;
  delete (globalThis as Record<string, unknown>).__dispatchEvent;
  delete (globalThis as Record<string, unknown>).__pushNativeEvent;
});

type Inspect = () => { commits: number; tree: { root: { type: string } } };

describe("inspector / devtools", () => {
  it("exposes __inspect with the current tree and commit count", () => {
    const host = new MemoryHost();
    runApp(
      <VStack>
        <Text>hi</Text>
      </VStack>,
      host,
    );
    const inspect = (globalThis as { __inspect?: Inspect }).__inspect!;
    const snapshot = inspect();
    expect(snapshot.tree.root.type).toBe("VStack");
    expect(snapshot.commits).toBeGreaterThanOrEqual(1);
  });
});
