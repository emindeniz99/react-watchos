// Tree-commit benchmark epilogue (NF-20), run by embed-host inside the
// VENDORED quickjs-ng — the exact interpreter the watch ships. The vitest
// bench (test/treediff.bench.test.tsx) runs under V8/JIT and its numbers
// must not be used for the tree-diff/patch-protocol decision; these must.
//
// Measures, on the real demo bundle's eager-mounted all-screens tree:
//   perDispatchMs           full pipeline per tap: React render + full-tree
//                           serialize + JSON.stringify + C hop
//   perSerializeMs          serializeTree only (__inspect, no stringify)
//   perSerializeStringifyMs serializeTree + JSON.stringify (the per-commit
//                           JS-side cost the no-op bailout also pays, NF-21)
(() => {
  while (__timers.length > 0) globalThis.__fireTimer(__timers.shift());
  // quickjs-ng ships performance.now (monotonic); Date.now is the shim
  // fallback. Integer-ms precision is fine over the iteration counts below.
  const now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const findAll = (node, type, out = []) => {
    if (node.type === type) out.push(node);
    for (const c of node.children) findAll(c, type, out);
    return out;
  };
  const countNodes = (n) =>
    n.children.reduce((sum, c) => sum + countNodes(c), 1);

  const initial = JSON.parse(__commits[__commits.length - 1]);
  const plus = findAll(initial.root, "Button").find((b) =>
    findAll(b, "Text").some((t) => t.props.text === "+"));

  const WARMUP = 20;
  for (let i = 0; i < WARMUP; i++) globalThis.__dispatchEvent(plus.id, "press");

  const N = 200;
  const t0 = now();
  for (let i = 0; i < N; i++) globalThis.__dispatchEvent(plus.id, "press");
  const perDispatchMs = (now() - t0) / N;

  const M = 200;
  const t1 = now();
  for (let i = 0; i < M; i++) globalThis.__inspect();
  const perSerializeMs = (now() - t1) / M;

  const t2 = now();
  for (let i = 0; i < M; i++) JSON.stringify(globalThis.__inspect().tree);
  const perSerializeStringifyMs = (now() - t2) / M;

  const lastJson = __commits[__commits.length - 1];
  return JSON.stringify({
    engine: "vendored quickjs-ng via embed-host",
    demoTreeNodes: countNodes(JSON.parse(lastJson).root),
    fullTreeKB: Math.round((lastJson.length / 1024) * 10) / 10,
    perDispatchMs: Math.round(perDispatchMs * 1000) / 1000,
    perSerializeMs: Math.round(perSerializeMs * 1000) / 1000,
    perSerializeStringifyMs: Math.round(perSerializeStringifyMs * 1000) / 1000,
    dispatches: WARMUP + N,
  });
})()
