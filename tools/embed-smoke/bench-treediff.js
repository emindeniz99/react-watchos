// Tree-diff workload benchmark (docs/perf-tree-diff.md), run by embed-host
// inside the VENDORED quickjs-ng against the real demo bundle — the
// decision-grade engine for the tree-diff/patch-protocol question (the
// vitest twin runs under V8 and generates fixtures, never numbers).
//
// bench-treediff.sh concatenates treediff-proto.js (the patch prototype)
// before this file, so `__treediff` is in scope.
//
// Workloads (all driven through the shipped event entrypoints, on the real
// demo screens):
//   counterTap      the NF-20 baseline: small screen, one Text changes
//   listAppend      /list/[id] grows by one row per interaction (2 dispatches:
//                   TextField change + Add-item press), timed in windows as
//                   the list grows to ~100 extra items
//   bigListToggle   one row toggled on the now-large detail screen — the
//                   "one Text out of hundreds of nodes" case
//   navSwap         pop/push of the large detail screen (ARCH-09 lazy
//                   mounting: a push re-mounts fresh ids)
//   sensorSmall     scenePhase pushes against the /stopwatch screen alone
//   sensorDeep      the same pushes with the large list stack covered
//                   underneath — the streaming worst case (covered entries
//                   stay serialized)
//   noopPush        the same push with an UNCHANGED payload (React state
//                   bailout: no render, no commit) — the no-op floor
//   hydration       Add-glass press incl. the app-side widget re-render
//
// Per workload it reports today's pipeline (perDispatchMs, serialize,
// serialize+stringify, full bytes/nodes) and the patch prototype on the same
// commits (changed nodes, patch bytes, post-hoc diff walk cost, the
// dirty-set patch build+stringify floor, and apply() round-trip check).
(() => {
  while (__timers.length > 0) globalThis.__fireTimer(__timers.shift());
  const td = globalThis.__treediff;
  const now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const r3 = (x) => Math.round(x * 1000) / 1000;

  const findAll = (node, type, out = []) => {
    if (node.type === type) out.push(node);
    for (const c of node.children) findAll(c, type, out);
    return out;
  };
  const buttonWithText = (root, text) =>
    findAll(root, "Button").find((b) =>
      findAll(b, "Text").some((t) => t.props.text === text));
  const lastJson = () => __commits[__commits.length - 1];
  const lastTree = () => JSON.parse(lastJson());

  const initial = lastTree();
  const rootId = initial.root.id;
  let seq = 100;
  const nav = (path) => {
    const verdict = JSON.parse(globalThis.__dispatchEvent(
      rootId, "pathChange", JSON.stringify({ path }), ++seq));
    if (verdict.accepted !== true) {
      throw new Error(`navigation to ${path.join(",")} declined: ${
        JSON.stringify(verdict)}`);
    }
  };

  // Serialize-only and serialize+stringify cost of the CURRENT tree.
  const serializeCosts = (iters) => {
    let t = now();
    for (let i = 0; i < iters; i++) globalThis.__inspect();
    const perSerializeMs = (now() - t) / iters;
    t = now();
    for (let i = 0; i < iters; i++) JSON.stringify(globalThis.__inspect().tree);
    const perSerializeStringifyMs = (now() - t) / iters;
    return { perSerializeMs: r3(perSerializeMs),
             perSerializeStringifyMs: r3(perSerializeStringifyMs) };
  };

  // Patch-prototype stats for one before->after commit pair.
  const diffStats = (beforeJson, afterJson, iters) => {
    const before = JSON.parse(beforeJson).root;
    const after = JSON.parse(afterJson).root;
    let t = now();
    let patch;
    for (let i = 0; i < iters; i++) patch = td.diffTrees(before, after);
    const diffWalkMs = (now() - t) / iters;
    const envelope = () => ({
      v: 1, seq: 0, root: patch.root,
      upsert: patch.upsert, removed: patch.removed,
    });
    t = now();
    let patchJson = "";
    for (let i = 0; i < iters; i++) patchJson = JSON.stringify(envelope());
    const patchStringifyMs = (now() - t) / iters;
    // The dirty-set floor: ids known from the reconciler's mutation hooks,
    // index maintained by the renderer already — per commit only the entry
    // build + stringify remains.
    const index = td.indexTree(after);
    const dirtyIds = patch.upsert.map((e) => e.id);
    t = now();
    for (let i = 0; i < iters; i++) {
      patchJson = JSON.stringify({
        v: 1, seq: 0,
        ...td.buildPatch(index, patch.root, dirtyIds, patch.removed),
      });
    }
    const dirtyBuildMs = (now() - t) / iters;
    const applied = td.applyPatch(before, patch);
    return {
      changedNodes: patch.upsert.length,
      removedNodes: patch.removed.length,
      patchKB: Math.round((patchJson.length / 1024) * 100) / 100,
      diffWalkMs: r3(diffWalkMs),
      patchStringifyMs: r3(patchStringifyMs),
      dirtyBuildMs: r3(dirtyBuildMs),
      applyOk: JSON.stringify(applied) === JSON.stringify(after),
    };
  };

  const treeFacts = () => {
    const json = lastJson();
    return {
      nodes: td.countNodes(JSON.parse(json).root),
      fullKB: Math.round((json.length / 1024) * 10) / 10,
    };
  };

  const results = { engine: "vendored quickjs-ng via embed-host" };

  // --- counterTap: the NF-20 baseline (small screen, one Text changes) ----
  nav(["/counter"]);
  const plus = buttonWithText(lastTree().root, "+");
  for (let i = 0; i < 20; i++) globalThis.__dispatchEvent(plus.id, "press");
  let n = 100;
  let t0 = now();
  for (let i = 0; i < n; i++) globalThis.__dispatchEvent(plus.id, "press");
  let beforeJson = __commits[__commits.length - 2];
  results.counterTap = {
    ...treeFacts(),
    perDispatchMs: r3((now() - t0) / n),
    ...serializeCosts(100),
    diff: diffStats(beforeJson, lastJson(), 100),
  };

  // --- listAppend: grow /list/groceries by ~100 rows ----------------------
  nav(["/lists", "/list/groceries"]);
  // Resolve targets once — ids are stable while the screen stays mounted,
  // and a per-iteration findAll would bill tree-walking to the pipeline.
  const detailFieldId = findAll(lastTree().root, "TextField")
    .find((f) => f.props.placeholder === "New item").id;
  const addItemId = buttonWithText(lastTree().root, "Add item").id;
  const appendOne = (i) => {
    globalThis.__dispatchEvent(
      detailFieldId, "change", JSON.stringify({ value: `Item ${i}` }));
    globalThis.__dispatchEvent(addItemId, "press");
  };
  const windows = [];
  const APPENDS = 100;
  const WINDOW = 20;
  for (let start = 0; start < APPENDS; start += WINDOW) {
    const t = now();
    for (let i = start; i < start + WINDOW; i++) appendOne(i);
    windows.push({
      items: start + WINDOW,
      perAppendMs: r3((now() - t) / WINDOW),
      ...treeFacts(),
    });
  }
  // Patch stats for one append at full size (the press commit: new row nodes
  // + List child-list + header counts).
  const beforeAppend = lastJson();
  appendOne(APPENDS);
  results.listAppend = {
    windows,
    diffAtFullSize: diffStats(beforeAppend, lastJson(), 20),
  };

  // --- bigListToggle: one row out of ~100+ ---------------------------------
  const milkId = buttonWithText(lastTree().root, "Milk").id;
  globalThis.__dispatchEvent(milkId, "press"); // warm both states
  n = 60;
  t0 = now();
  for (let i = 0; i < n; i++) globalThis.__dispatchEvent(milkId, "press");
  beforeJson = __commits[__commits.length - 2];
  results.bigListToggle = {
    ...treeFacts(),
    perDispatchMs: r3((now() - t0) / n),
    ...serializeCosts(40),
    diff: diffStats(beforeJson, lastJson(), 40),
  };

  // --- navSwap: pop/push the large detail screen ---------------------------
  n = 30;
  t0 = now();
  for (let i = 0; i < n; i++) {
    nav(["/lists"]);
    nav(["/lists", "/list/groceries"]);
  }
  const perSwapMs = r3((now() - t0) / (n * 2));
  nav(["/lists"]);
  const smallJson = lastJson();
  nav(["/lists", "/list/groceries"]);
  results.navSwap = {
    ...treeFacts(),
    perSwapMs,
    pushDiff: diffStats(smallJson, lastJson(), 10),
    popDiff: diffStats(lastJson(), smallJson, 10),
  };

  // --- sensorSmall: scenePhase stream against /stopwatch alone -------------
  const phases = ["background", "active"];
  const push = (i) => globalThis.__pushNativeEvent(
    "scenePhase", JSON.stringify({ phase: phases[i % 2] }));
  nav(["/stopwatch"]);
  push(0);
  push(1);
  n = 200;
  t0 = now();
  for (let i = 0; i < n; i++) push(i);
  beforeJson = __commits[__commits.length - 2];
  results.sensorSmall = {
    ...treeFacts(),
    perPushMs: r3((now() - t0) / n),
    ...serializeCosts(100),
    diff: diffStats(beforeJson, lastJson(), 100),
  };

  // --- sensorDeep: the same stream, with the large list ON TOP and the
  // stopwatch (which holds the scenePhase listener) mounted-but-covered.
  // Covered entries stay serialized, so each push re-serializes the whole
  // stack. (The stopwatch must sit at the BOTTOM: a covered dynamic route
  // loses its params — focused-only params in navigation.tsx — so covering
  // /list/[id] would shrink it to a "List not found" placeholder; see the
  // incidental-findings section of docs/perf-tree-diff.md.)
  nav(["/stopwatch", "/lists", "/list/groceries"]);
  push(0);
  push(1);
  n = 100;
  t0 = now();
  for (let i = 0; i < n; i++) push(i);
  beforeJson = __commits[__commits.length - 2];
  results.sensorDeep = {
    ...treeFacts(),
    perPushMs: r3((now() - t0) / n),
    ...serializeCosts(40),
    diff: diffStats(beforeJson, lastJson(), 40),
  };

  // --- noopPush: unchanged payload -> React state bailout, no commit -------
  const commitsBefore = __commits.length;
  n = 200;
  t0 = now();
  for (let i = 0; i < n; i++) {
    globalThis.__pushNativeEvent(
      "scenePhase", JSON.stringify({ phase: "active" }));
  }
  results.noopPush = {
    perPushMs: r3((now() - t0) / n),
    commits: __commits.length - commitsBefore,
  };

  // --- hydration: interaction that also re-renders widget timelines --------
  nav(["/hydration"]);
  const addGlass = buttonWithText(lastTree().root, "Add glass");
  globalThis.__dispatchEvent(addGlass.id, "press");
  while (__timers.length > 0) globalThis.__fireTimer(__timers.shift());
  n = 30;
  t0 = now();
  for (let i = 0; i < n; i++) {
    globalThis.__dispatchEvent(addGlass.id, "press");
    // Fire the publish debounce timer so every press pays its republish.
    while (__timers.length > 0) globalThis.__fireTimer(__timers.shift());
  }
  results.hydration = {
    ...treeFacts(),
    perPressWithPublishMs: r3((now() - t0) / n),
  };

  // The C harness retains EVERY commit string in __commits (hundreds here, up
  // to ~74 KB each) — drop them so the [mem] line embed-host prints on exit
  // reflects the app's steady state, not the harness's history.
  __commits.splice(0, __commits.length - 1);

  return JSON.stringify(results);
})()
