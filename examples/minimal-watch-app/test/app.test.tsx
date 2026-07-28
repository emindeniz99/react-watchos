import { MemoryHost, runApp } from "react-watchos";
import { findByText, findByType } from "react-watchos/testing";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

// Exercises the public testing surface end-to-end: runApp + MemoryHost +
// the query helpers, all from the package (no copied findByType).
describe("minimal watch app", () => {
  it("renders a counter and increments on press", () => {
    const host = new MemoryHost();
    const root = runApp(<App />, host);

    const tree = host.lastCommit?.root;
    if (!tree) throw new Error("no commit");
    expect(findByText(tree, "Count: 0")).toHaveLength(1);

    // Two buttons: [decrement, increment]. Press the second.
    const increment = findByType(tree, "Button")[1];
    if (!increment) throw new Error("no increment button");
    root.dispatchEvent({ nodeId: increment.id, event: "press" });

    const next = host.lastCommit?.root;
    if (!next) throw new Error("no commit after press");
    expect(findByText(next, "Count: 1")).toHaveLength(1);

    // One root at a time (ARCH-08): dispose unmounts the tree and runs every
    // effect cleanup, so a later test in this file can mount its own root
    // instead of hitting "a root is already mounted".
    root.dispose();
  });
});
