import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Button,
  MemoryHost,
  Text,
  Toggle,
  VStack,
  WatchRoot,
} from "../src/index";
import { findByType } from "./helpers";

describe("events", () => {
  it("dispatches press to the onPress handler", () => {
    const onPress = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <Button onPress={onPress}>
        <Text>tap</Text>
      </Button>,
    );
    const button = findByType(host.lastCommit!.root!, "Button")[0];
    expect(root.dispatchEvent({ nodeId: button.id, event: "press" })).toBe(
      true,
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("dispatches change with the payload value", () => {
    function Wifi() {
      const [on, setOn] = useState(false);
      return <Toggle value={on} onChange={setOn} label="Wifi" />;
    }
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Wifi />);
    const toggle = findByType(host.lastCommit!.root!, "Toggle")[0];

    root.dispatchEvent({
      nodeId: toggle.id,
      event: "change",
      payload: { value: true },
    });

    const updated = findByType(host.lastCommit!.root!, "Toggle")[0];
    expect(updated.props.value).toBe(true);
  });

  it("dispatches longPress to the onLongPress handler", () => {
    const onLongPress = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <Button onPress={() => {}} onLongPress={onLongPress}>
        <Text>hold</Text>
      </Button>,
    );
    const button = findByType(host.lastCommit!.root!, "Button")[0];
    expect(button.props).toMatchObject({ onPress: true, onLongPress: true });
    expect(root.dispatchEvent({ nodeId: button.id, event: "longPress" })).toBe(
      true,
    );
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("serializes the focusable flag", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <VStack focusable>
        <Text>focus me</Text>
      </VStack>,
    );
    expect(host.lastCommit!.root!.props.focusable).toBe(true);
  });

  it("streams drag translation to the onDrag handler", () => {
    const onDrag = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack onDrag={onDrag}>
        <Text>scrub</Text>
      </VStack>,
    );
    const stack = host.lastCommit!.root!;
    expect(stack.props.onDrag).toBe(true);
    root.dispatchEvent({
      nodeId: stack.id,
      event: "drag",
      payload: { x: 12, y: 0 },
    });
    expect(onDrag).toHaveBeenCalledWith({ x: 12, y: 0 });
  });

  it("dispatches swipe with its direction", () => {
    const onSwipe = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack onSwipe={onSwipe}>
        <Text>swipe me</Text>
      </VStack>,
    );
    const stack = host.lastCommit!.root!;
    root.dispatchEvent({
      nodeId: stack.id,
      event: "swipe",
      payload: { direction: "left" },
    });
    expect(onSwipe).toHaveBeenCalledWith("left");
  });

  it("ignores events for stale or unknown node ids", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack>
        <Text>static</Text>
      </VStack>,
    );
    const commitsBefore = host.commits.length;
    expect(root.dispatchEvent({ nodeId: 9999, event: "press" })).toBe(false);
    expect(host.commits.length).toBe(commitsBefore);
  });

  it("ignores events a node has no handler for", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Text>static</Text>);
    const text = host.lastCommit!.root!;
    expect(root.dispatchEvent({ nodeId: text.id, event: "press" })).toBe(
      false,
    );
  });
});
