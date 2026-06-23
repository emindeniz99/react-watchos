import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Button,
  HStack,
  MemoryHost,
  NavigationStack,
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

  it("dispatches native navigation path changes to onPathChange", () => {
    const onPathChange = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <NavigationStack path={[]} onPathChange={onPathChange}>
        <Text>home</Text>
      </NavigationStack>,
    );
    const stack = findByType(host.lastCommit!.root!, "NavigationStack")[0];

    expect(
      root.dispatchEvent({
        nodeId: stack.id,
        event: "pathChange",
        payload: { path: ["/hydration"] },
      }),
    ).toBe(true);
    expect(onPathChange).toHaveBeenCalledWith(["/hydration"]);
  });

  it("serializes the primaryAction (double-tap) flag", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <Button primaryAction onPress={() => {}}>
        <Text>go</Text>
      </Button>,
    );
    expect(host.lastCommit!.root!.props.primaryAction).toBe(true);
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

  it("serializes the focusable and glass flags", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <VStack focusable glass>
        <Text>focus me</Text>
      </VStack>,
    );
    expect(host.lastCommit!.root!.props).toMatchObject({
      focusable: true,
      glass: true,
    });
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

  it("dispatches a swipe action to onSwipeAction", () => {
    const onSwipeAction = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <Button onSwipeAction={onSwipeAction} swipeActionLabel="Done">
        <Text>row</Text>
      </Button>,
    );
    const button = findByType(host.lastCommit!.root!, "Button")[0];
    expect(
      root.dispatchEvent({ nodeId: button.id, event: "swipeAction" }),
    ).toBe(true);
    expect(onSwipeAction).toHaveBeenCalledTimes(1);
  });

  it("dispatches a leading swipe action to onLeadingSwipeAction", () => {
    // The leading edge is a second, independent action (swipe right = Done)
    // alongside the trailing one (swipe left = Undone). Its props must
    // serialize separately so the native row can render both edges.
    const onLeadingSwipeAction = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <Button
        onLeadingSwipeAction={onLeadingSwipeAction}
        leadingSwipeActionLabel="Done"
        leadingSwipeActionSystemImage="checkmark"
        leadingSwipeActionTint="green"
      >
        <Text>row</Text>
      </Button>,
    );
    const button = findByType(host.lastCommit!.root!, "Button")[0];
    expect(button.props).toMatchObject({
      leadingSwipeActionLabel: "Done",
      leadingSwipeActionSystemImage: "checkmark",
      leadingSwipeActionTint: "green",
      onLeadingSwipeAction: true,
    });
    expect(
      root.dispatchEvent({ nodeId: button.id, event: "leadingSwipeAction" }),
    ).toBe(true);
    expect(onLeadingSwipeAction).toHaveBeenCalledTimes(1);
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

  it("stops dispatching to a node after its subtree is removed", () => {
    // detachDeletedInstance must clear the event-target map for every node in
    // a removed subtree, not just its root — otherwise a stale id would still
    // resolve to a live handler (a leak). The Button is a deep descendant of
    // the conditionally-rendered subtree.
    const onPress = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    function Tree({ show }: { show: boolean }) {
      return (
        <VStack>
          {show ? (
            <VStack>
              <HStack>
                <Button onPress={onPress}>
                  <Text>deep</Text>
                </Button>
              </HStack>
            </VStack>
          ) : null}
        </VStack>
      );
    }
    root.render(<Tree show={true} />);
    const button = findByType(host.lastCommit!.root!, "Button")[0];
    expect(root.dispatchEvent({ nodeId: button.id, event: "press" })).toBe(
      true,
    );
    expect(onPress).toHaveBeenCalledTimes(1);

    root.render(<Tree show={false} />);
    expect(root.dispatchEvent({ nodeId: button.id, event: "press" })).toBe(
      false,
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("ignores events a node has no handler for", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Text>static</Text>);
    const text = host.lastCommit!.root!;
    expect(root.dispatchEvent({ nodeId: text.id, event: "press" })).toBe(false);
  });
});
