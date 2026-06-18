import { MemoryHost, runApp } from "react-native-watchos";
import { findByText, findByType } from "react-native-watchos/testing";
import { describe, expect, it } from "vitest";
import { App } from "../watch-ui/App";

describe("watch UI", () => {
  it("renders the phone-status screen and replies on press", () => {
    const host = new MemoryHost();
    const root = runApp(<App />, host);

    const tree = host.lastCommit?.root;
    if (!tree) throw new Error("no commit");
    expect(findByText(tree, "waiting for phone…")).toHaveLength(1);

    // Pressing the button calls sendToPhone, which no-ops without a native
    // host — it must not throw, and the screen stays mounted.
    const button = findByType(tree, "Button")[0];
    if (!button) throw new Error("no button");
    expect(root.dispatchEvent({ nodeId: button.id, event: "press" })).toBe(true);
  });
});
