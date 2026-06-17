import { describe, expect, it, vi } from "vitest";
import {
  Button,
  ErrorBoundary,
  MemoryHost,
  type SerializedNode,
  Text,
  VStack,
  WatchRoot,
} from "../src/index";

function Boom(): never {
  throw new Error("kaboom");
}

function texts(node: SerializedNode): string[] {
  return [
    ...(node.type === "Text" ? [String(node.props.text)] : []),
    ...node.children.flatMap(texts),
  ];
}

describe("ErrorBoundary", () => {
  it("renders the fallback and keeps siblings when a child throws", () => {
    const onError = vi.fn();
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <VStack>
        <Text>before</Text>
        <ErrorBoundary fallback={<Text>recovered</Text>} onError={onError}>
          <Boom />
        </ErrorBoundary>
        <Text>after</Text>
      </VStack>,
    );

    expect(texts(host.lastCommit!.root!)).toEqual([
      "before",
      "recovered",
      "after",
    ]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("passes the error to a function fallback", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <ErrorBoundary fallback={(e) => <Text>{`oops: ${e.message}`}</Text>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(host.lastCommit!.root!.props.text).toBe("oops: kaboom");
  });

  it("renders children normally when nothing throws", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <ErrorBoundary fallback={<Text>fallback</Text>}>
        <Button onPress={() => {}}>
          <Text>ok</Text>
        </Button>
      </ErrorBoundary>,
    );
    expect(texts(host.lastCommit!.root!)).toEqual(["ok"]);
  });
});
