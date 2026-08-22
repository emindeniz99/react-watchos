import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../demo/App";
import type { HostBridge, SerializedNode, SerializedTree } from "../src/index";
import { findByText, findByType, mountApp, resetApp } from "../src/testing";

/**
 * Tree-diff prototype: correctness pinning + Swift fixture generation
 * (docs/perf-tree-diff.md).
 *
 * Drives the REAL demo app through the same workloads the engine bench
 * (tools/embed-smoke/bench-treediff.sh) times inside the vendored quickjs-ng,
 * and evals the SAME prototype implementation (treediff-proto.js — one
 * source, never a vitest copy) to pin, under V8:
 *   - the patch round-trips (applyPatch(before, diff) === after) for EVERY
 *     commit the workloads produce — taps, list growth, multi-screen
 *     navigation remounts, pops;
 *   - the patch is node-minimal where it should be (one Text change on a
 *     ~600-node screen upserts a handful of nodes, not hundreds).
 *
 * It then writes the before/after wire payloads plus the patch as fixtures
 * for TreeDiffBenchTests.swift, which re-applies the patch in Swift over
 * decoded RNNode values — the cross-language half of the prototype. The
 * tree fixtures are the commit JSON VERBATIM (compact, exactly the wire
 * string Swift decodes on-device), unlike the pretty-printed contract
 * fixtures next to them. NO performance numbers come from this file — V8
 * timings are not decision-grade (docs/performance-measurement.md §2).
 */

const fixturesDir = join(__dirname, "../swift/Tests/ReactWatchTests/Fixtures");
const protoPath = join(__dirname, "../../tools/embed-smoke/treediff-proto.js");

interface PatchEntry {
  id: number;
  type: string;
  props: Record<string, unknown>;
  children: number[];
}
interface TreePatch {
  root: number | null;
  upsert: PatchEntry[];
  removed: number[];
}
interface TreeDiffProto {
  indexTree(root: SerializedNode): Map<number, SerializedNode>;
  countNodes(node: SerializedNode | null): number;
  jsonEqual(a: unknown, b: unknown): boolean;
  diffTrees(
    oldRoot: SerializedNode | null,
    newRoot: SerializedNode | null,
  ): TreePatch;
  buildPatch(
    index: Map<number, SerializedNode>,
    rootId: number | null,
    dirtyIds: number[],
    removed: number[],
  ): TreePatch;
  applyPatch(
    oldRoot: SerializedNode | null,
    patch: TreePatch,
  ): SerializedNode | null;
}

// The prototype is engine-plain JS (it must run unmodified inside quickjs-ng),
// so it arrives here by eval rather than import.
const proto = new Function(
  `${readFileSync(protoPath, "utf8")}; return globalThis.__treediff;`,
)() as TreeDiffProto;

/** Captures the exact wire string of every commit (MemoryHost drops it). */
class WireHost implements HostBridge {
  jsons: string[] = [];
  commit(tree: SerializedTree, json?: string): void {
    this.jsons.push(json ?? JSON.stringify(tree));
  }
}

const root = (json: string): SerializedNode | null =>
  (JSON.parse(json) as SerializedTree).root;

/** Patch envelope exactly as the bench and the Swift test read it. */
const envelope = (seq: number, patch: TreePatch): string =>
  JSON.stringify({
    v: 1,
    seq,
    root: patch.root,
    upsert: patch.upsert,
    removed: patch.removed,
  });

const realDateNow = Date.now;

beforeAll(() => {
  // shoppingStore ids embed Date.now() — freeze it so the fixtures are
  // byte-stable across runs/machines (CI diffs them against the committed
  // copies, same posture as the contract fixtures).
  Date.now = () => 1_750_000_000_000;
});

afterAll(() => {
  Date.now = realDateNow;
  delete (globalThis as { __treediff?: unknown }).__treediff;
});

afterEach(resetApp);

describe("tree-diff prototype on the real demo workloads", () => {
  it("round-trips every workload commit and writes the Swift fixtures", () => {
    const host = new WireHost();
    const app = mountApp(<App />, host);
    const stackId = (root(host.jsons[0]) as SerializedNode).id;
    let seq = 10;
    const nav = (path: string[]) => {
      const verdict = app.dispatchEvent({
        nodeId: stackId,
        event: "pathChange",
        payload: { path },
        seq: ++seq,
      });
      expect(verdict.accepted).toBe(true);
    };
    const press = (node: SerializedNode) =>
      app.dispatchEvent({ nodeId: node.id, event: "press" });
    const latest = () => root(host.jsons[host.jsons.length - 1]);
    const buttonWithText = (text: string) => {
      const match = findByType(latest() as SerializedNode, "Button").find(
        (b) => findByText(b, text).length > 0,
      );
      if (!match) throw new Error(`no Button containing "${text}"`);
      return match;
    };

    // -- small pair: the counter tap (one Text out of ~50 nodes) ------------
    nav(["/counter"]);
    const smallBefore = host.jsons[host.jsons.length - 1];
    press(buttonWithText("+"));
    const smallAfter = host.jsons[host.jsons.length - 1];
    const smallPatch = proto.diffTrees(root(smallBefore), root(smallAfter));
    // The tap changes exactly the counter Text node.
    expect(smallPatch.upsert).toHaveLength(1);
    expect(smallPatch.upsert[0].type).toBe("Text");
    expect(smallPatch.removed).toHaveLength(0);

    // -- large pair: grow /list/groceries to 100+ rows, toggle one ----------
    nav(["/lists", "/list/groceries"]);
    const field = findByType(latest() as SerializedNode, "TextField").find(
      (f) => f.props.placeholder === "New item",
    );
    if (!field) throw new Error("no New-item TextField on the detail screen");
    const addItem = buttonWithText("Add item");
    for (let i = 0; i < 100; i++) {
      app.dispatchEvent({
        nodeId: field.id,
        event: "change",
        payload: { value: `Item ${i}` },
      });
      press(addItem);
    }
    const largeBefore = host.jsons[host.jsons.length - 1];
    const largeNodes = proto.countNodes(root(largeBefore));
    expect(largeNodes).toBeGreaterThan(500);
    press(buttonWithText("Milk"));
    const largeAfter = host.jsons[host.jsons.length - 1];
    const largePatch = proto.diffTrees(root(largeBefore), root(largeAfter));
    // One row toggled: the row's Image/Text, its Button label, and the two
    // count Texts (detail header + covered lists row) — a handful of nodes,
    // never the ~600-node tree.
    expect(largePatch.upsert.length).toBeGreaterThan(0);
    expect(largePatch.upsert.length).toBeLessThan(12);
    expect(largePatch.removed).toHaveLength(0);
    expect(envelope(0, largePatch).length).toBeLessThan(largeAfter.length / 10);

    // -- more workload shapes for the round-trip sweep ----------------------
    nav(["/lists"]); // pop: hundreds of removed ids
    nav(["/lists", "/list/groceries"]); // push: fresh remount, all-new subtree
    nav(["/stopwatch"]); // full stack swap

    // -- the pin: every consecutive commit pair round-trips through the
    // patch, including the initial null->tree commit.
    const pairs = host.jsons.length - 1;
    expect(pairs).toBeGreaterThan(200);
    for (let i = 0; i < host.jsons.length; i++) {
      const before = i === 0 ? null : root(host.jsons[i - 1]);
      const after = root(host.jsons[i]);
      const patch = proto.diffTrees(before, after);
      const applied = proto.applyPatch(before, patch);
      expect(JSON.stringify(applied)).toBe(JSON.stringify(after));
    }

    // -- dirty-set builder parity: given the changed ids, buildPatch (the
    // near-free production path) emits the same patch the differ found.
    const index = proto.indexTree(root(largeAfter) as SerializedNode);
    const rebuilt = proto.buildPatch(
      index,
      largePatch.root,
      largePatch.upsert.map((e) => e.id),
      largePatch.removed,
    );
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(largePatch));

    // -- Swift fixtures: the wire strings verbatim + the patch envelopes.
    mkdirSync(fixturesDir, { recursive: true });
    const write = (name: string, contents: string) =>
      writeFileSync(join(fixturesDir, name), `${contents}\n`);
    write("treediff-small-before.json", smallBefore);
    write("treediff-small-after.json", smallAfter);
    write(
      "treediff-small-patch.json",
      envelope((JSON.parse(smallAfter) as SerializedTree).seq, smallPatch),
    );
    write("treediff-large-before.json", largeBefore);
    write("treediff-large-after.json", largeAfter);
    write(
      "treediff-large-patch.json",
      envelope((JSON.parse(largeAfter) as SerializedTree).seq, largePatch),
    );
  });

  it("fails loud on a patch against the wrong base (the resync hazard)", () => {
    const host = new WireHost();
    const app = mountApp(<App />, host);
    const stackId = (root(host.jsons[0]) as SerializedNode).id;
    app.dispatchEvent({
      nodeId: stackId,
      event: "pathChange",
      payload: { path: ["/counter"] },
      seq: 1,
    });
    const before = root(host.jsons[host.jsons.length - 1]);
    const plus = findByType(before as SerializedNode, "Button").find(
      (b) => findByText(b, "+").length > 0,
    );
    if (!plus) throw new Error("no + button");
    app.dispatchEvent({ nodeId: plus.id, event: "press" });
    const after = root(host.jsons[host.jsons.length - 1]);
    const patch = proto.diffTrees(before, after);
    // Applying against a base that lacks the referenced ids must throw, not
    // silently produce a wrong tree — this is the stale-base case a shipped
    // protocol would have to detect and answer with a full-tree resync.
    const wrongBase = (before as SerializedNode).children[0];
    expect(() => proto.applyPatch(wrongBase, patch)).toThrow(/unknown node id/);
  });
});
