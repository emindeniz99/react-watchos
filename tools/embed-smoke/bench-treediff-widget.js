// Widget-timeline publish workload (docs/perf-tree-diff.md), run by
// embed-host against the WIDGET bundle (js/dist/widget.bundle.js). One
// publish renders EVERY registered timeline via the reconciler-free static
// walker and stringifies the whole document — there is no "previous tree" on
// this path (the extension is a discard-after-return process), so a patch
// protocol cannot apply to it by construction; this run pins what the
// full-document publish actually costs instead.
(() => {
  const now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const countNodes = (node) =>
    node ? node.children.reduce((sum, c) => sum + countNodes(c), 1) : 0;

  let out = globalThis.__renderWidgets(1750000000000); // warm
  const N = 100;
  const t0 = now();
  for (let i = 0; i < N; i++) {
    out = globalThis.__renderWidgets(1750000000000 + i * 60000);
  }
  const perRenderMs = (now() - t0) / N;

  const parsed = JSON.parse(out);
  let entries = 0;
  let nodes = 0;
  for (const widget of Object.values(parsed.widgets)) {
    for (const family of Object.values(widget)) {
      entries += family.entries.length;
      for (const entry of family.entries) nodes += countNodes(entry.tree);
    }
  }
  return JSON.stringify({
    engine: "vendored quickjs-ng via embed-host (widget bundle)",
    perRenderMs: Math.round(perRenderMs * 1000) / 1000,
    publishKB: Math.round((out.length / 1024) * 10) / 10,
    timelineEntries: entries,
    treeNodes: nodes,
  });
})()
