// EXPERIMENT (see README.md) — the embed-smoke assertions, lifted verbatim out
// of tools/embed-smoke/embed-host.c's built-in `epilogue` string so that BOTH
// engines can run the identical text.
//
// Everything below the comment block is byte-for-byte what embed-host.c
// compiles in. It is a file rather than a second copy inside jsc-host.c because
// embed-host.c already accepts an epilogue path as its optional second
// argument (added for the NF-20 tree-commit bench), so the quickjs-ng baseline
// runs THIS file through the repo's own unmodified host and the JSC host runs
// the same bytes. A benchmark where the two engines are asked different
// questions is not a benchmark.
//
//   tools/embed-smoke/embed-host   ../../js/dist/bundle.js smoke-epilogue.js
//   out/jsc-host                   ../../js/dist/bundle.js smoke-epilogue.js
//
// Both must print the same JSON:
//   {"nav":{"handled":true,"accepted":true},
//    "result":{"handled":true,"accepted":true},
//    "initialCount":"Count: 0","countAfterPress":"Count: 1"}
(() => {
  while (__timers.length > 0) globalThis.__fireTimer(__timers.shift());
  const findAll = (node, type, out = []) => {
    if (node.type === type) out.push(node);
    for (const c of node.children) findAll(c, type, out);
    return out;
  };
  const countText = (root) => findAll(root, 'Text')
    .find((t) => String(t.props.text).startsWith('Count: '));
  const initial = JSON.parse(__commits[__commits.length - 1]);
  // ARCH-09 lazy mounting: the launch tree carries only the root
  // screen — /counter must NOT be serialized yet.
  if (countText(initial.root))
    throw new Error('inactive /counter was serialized at launch');
  // Navigation is a confirmed transaction: propose the path, expect the
  // accepted verdict, and the SAME commit carries the mounted subtree.
  const nav = JSON.parse(globalThis.__dispatchEvent(initial.root.id,
    'pathChange', JSON.stringify({ path: ['/counter'] }), 1));
  if (nav.accepted !== true)
    throw new Error('navigation not accepted: ' + JSON.stringify(nav));
  const mounted = JSON.parse(__commits[__commits.length - 1]);
  const plus = findAll(mounted.root, 'Button').find((b) =>
    findAll(b, 'Text').some((t) => t.props.text === '+'));
  // __dispatchEvent returns the structured verdict as JSON (ARCH-09).
  const result = JSON.parse(
    globalThis.__dispatchEvent(plus.id, 'press'));
  const after = JSON.parse(__commits[__commits.length - 1]);
  const initialCount = countText(mounted.root).props.text;
  const countAfterPress = countText(after.root).props.text;
  // Assert, don't just report (M14): this is the ONLY run of the
  // production bundle inside the real vendored engine — exiting 0 on a
  // wrong result made the whole gate decorative.
  if (result.handled !== true || result.accepted !== true)
    throw new Error('press dispatch not handled: ' +
      JSON.stringify(result));
  const n = (s) => Number(String(s).slice('Count: '.length));
  if (n(countAfterPress) !== n(initialCount) + 1)
    throw new Error('count did not advance: ' +
      initialCount + ' -> ' + countAfterPress);
  return JSON.stringify({ nav, result, initialCount, countAfterPress });
})()
