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
