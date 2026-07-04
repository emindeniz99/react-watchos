import { describe, expect, it } from "vitest";
import { List, MemoryHost, Text, VStack, WatchRoot } from "../src/index";

// Measure-first gate for the tree-diff/patch protocol (docs/roadmap.md E):
// prove the full-tree serialize+commit cost of a large List before building
// a patch protocol. Result (200 rows): ~13 KB, ~0.04 ms/serialize — BUT this
// runs under V8/JIT; the shipping engine is an interpreter, ~25x slower on
// this path (NF-20). The decision-grade numbers come from
// tools/embed-smoke/bench.sh, which runs the real demo bundle inside the
// vendored quickjs-ng (CI step "Tree-commit bench"). This stays only as a
// V8-side regression guard on tree size.

const ROWS = 200;

function BigList({ bump }: { bump: number }) {
  return (
    <VStack>
      <List>
        {Array.from({ length: ROWS }, (_, i) => (
          <Text key={i}>{`Row ${i}${i === 0 ? ` (${bump})` : ""}`}</Text>
        ))}
      </List>
    </VStack>
  );
}

describe("tree-diff benchmark (measure-first)", () => {
  it("full-tree serialize cost for a 200-row list is negligible", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<BigList bump={0} />);

    const bytes = JSON.stringify(host.lastCommit).length;
    const N = 200;
    const start = performance.now();
    for (let i = 0; i < N; i++) JSON.stringify(host.lastCommit);
    const perSerializeMs = (performance.now() - start) / N;

    // A one-row change re-renders the whole list to a fresh full-tree commit
    // (what a patch would shrink). Verify it commits and stays cheap.
    const before = host.commits.length;
    root.render(<BigList bump={1} />);
    expect(host.commits.length).toBe(before + 1);

    // eslint-disable-next-line no-console
    console.log(
      `\n[tree-diff bench] rows=${ROWS} fullTreeBytes=${(bytes / 1024).toFixed(1)}KB ` +
        `serialize=${perSerializeMs.toFixed(3)}ms/commit\n`,
    );

    expect(bytes).toBeLessThan(64 * 1024); // regression guard
    expect(perSerializeMs).toBeLessThan(5);
  });
});
