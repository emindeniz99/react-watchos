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

  it("surfaces the React componentStack to onError", () => {
    // The component stack is the 'where did it break' signal a dev overlay /
    // remote inspector needs — the boundary must forward it, not drop it.
    const onError = vi.fn();
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <ErrorBoundary fallback={<Text>recovered</Text>} onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    const info = onError.mock.calls[0][1];
    expect(typeof info.componentStack).toBe("string");
    // The failing component appears in the stack React hands us.
    expect(info.componentStack).toContain("Boom");
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

  it("gives the function fallback the componentStack after componentDidCatch", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <ErrorBoundary
        fallback={(e, info) => (
          <Text>{`${e.message}@${info?.componentStack ? "Boom" : "none"}`}</Text>
        )}
      >
        <Boom />
      </ErrorBoundary>,
    );
    // The re-render triggered by componentDidCatch's setState carries the stack.
    expect(host.lastCommit!.root!.props.text).toBe("kaboom@Boom");
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
