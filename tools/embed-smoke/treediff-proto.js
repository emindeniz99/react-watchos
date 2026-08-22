// Tree-diff PROTOTYPE (docs/perf-tree-diff.md) — measurement code, not
// shipped. The single JS implementation of the candidate patch protocol
// ("commit protocol v2" from the 2026-07-01 alternatives review §2.3), used
// by BOTH measurement harnesses so the semantics cannot fork:
//   - tools/embed-smoke/bench-treediff.sh concatenates this file before
//     bench-treediff.js and times it inside the vendored quickjs-ng;
//   - js/test/treediff-workloads.test.tsx evals this file to generate the
//     Swift fixture pairs + patches and to pin apply() round-trip
//     correctness on every workload commit (V8 side).
// The Swift half of the apply lives in TreeDiffBenchTests.swift and is held
// to this implementation by the cross-language fixtures.
//
// Patch shape (one entry per node whose wire content changed):
//   { root: <id|null>,
//     upsert: [{ id, type, props, children: [childIds] }],
//     removed: [ids] }
// A node is upserted when it is new, its serialized props changed, or its
// child ID LIST changed (insert/remove/reorder). Unchanged descendants are
// carried by id reference, so apply() can reuse their old subtrees whole —
// the structural-sharing half of the bet, see the report.
//
// Engine-safe plain JS (no modules, no Node APIs): runs verbatim under
// quickjs-ng via embed-host and under V8 via `new Function`.
globalThis.__treediff = (() => {
  /** id -> node over a serialized tree (stands in for container.instances). */
  function indexTree(root) {
    const map = new Map();
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      map.set(node.id, node);
      for (const child of node.children) stack.push(child);
    }
    return map;
  }

  function countNodes(node) {
    return node
      ? node.children.reduce((sum, child) => sum + countNodes(child), 1)
      : 0;
  }

  /** Deep equality over serialized (pure-JSON) prop values. */
  function jsonEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object" || a === null || b === null) return false;
    const aIsArray = Array.isArray(a);
    if (aIsArray !== Array.isArray(b)) return false;
    if (aIsArray) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!jsonEqual(a[i], b[i])) return false;
      }
      return true;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!(key in b) || !jsonEqual(a[key], b[key])) return false;
    }
    return true;
  }

  /**
   * POST-HOC differ: computes the patch from two serialized trees. This is
   * the expensive fallback shape (O(old + new) walk + deep prop compares);
   * the production variant would instead collect dirty ids in the host
   * config's mutation hooks (the NF-21 dirty flag widened to a Set) and pay
   * only buildPatch() below. Both are timed by the bench.
   */
  function diffTrees(oldRoot, newRoot) {
    const oldIndex = oldRoot ? indexTree(oldRoot) : new Map();
    const upsert = [];
    const visited = new Set();
    const walk = (node) => {
      visited.add(node.id);
      const old = oldIndex.get(node.id);
      let changed = false;
      if (
        old === undefined ||
        old.type !== node.type ||
        old.children.length !== node.children.length ||
        !jsonEqual(old.props, node.props)
      ) {
        changed = true;
      } else {
        for (let i = 0; i < node.children.length; i++) {
          if (old.children[i].id !== node.children[i].id) {
            changed = true;
            break;
          }
        }
      }
      if (changed) {
        upsert.push({
          id: node.id,
          type: node.type,
          props: node.props,
          children: node.children.map((child) => child.id),
        });
      }
      for (const child of node.children) walk(child);
    };
    if (newRoot) walk(newRoot);
    const removed = [];
    for (const id of oldIndex.keys()) {
      if (!visited.has(id)) removed.push(id);
    }
    return { root: newRoot ? newRoot.id : null, upsert, removed };
  }

  /**
   * The near-free serializer path a REAL dirty-set implementation would pay
   * per commit: one entry per known-dirty id, looked up in an id index the
   * renderer already maintains (container.instances). No tree walk, no
   * compares.
   */
  function buildPatch(index, rootId, dirtyIds, removed) {
    const upsert = [];
    for (const id of dirtyIds) {
      const node = index.get(id);
      upsert.push({
        id: node.id,
        type: node.type,
        props: node.props,
        children: node.children.map((child) => child.id),
      });
    }
    return { root: rootId, upsert, removed };
  }

  /**
   * Receiver-side apply with structural sharing: unchanged subtrees are
   * returned by reference (the persistent path-copy the Swift side would do
   * over RNNode values). Throws on an unknown id — a patch against the wrong
   * base must fail loud, which is exactly the resync machinery a shipped
   * protocol would need (see the report's cost section).
   */
  function applyPatch(oldRoot, patch) {
    const oldIndex = oldRoot ? indexTree(oldRoot) : new Map();
    const parents = new Map();
    if (oldRoot) {
      const stack = [oldRoot];
      while (stack.length > 0) {
        const node = stack.pop();
        for (const child of node.children) {
          parents.set(child.id, node.id);
          stack.push(child);
        }
      }
    }
    const upsertMap = new Map();
    for (const entry of patch.upsert) upsertMap.set(entry.id, entry);
    // Transitively-dirty: every upserted id plus its ancestors in the OLD
    // tree (new nodes have no old parent; their parent's child list changed,
    // so the parent is itself upserted and seeds its own chain).
    const dirty = new Set();
    for (const entry of patch.upsert) {
      dirty.add(entry.id);
      let parent = parents.get(entry.id);
      while (parent !== undefined && !dirty.has(parent)) {
        dirty.add(parent);
        parent = parents.get(parent);
      }
    }
    const build = (id) => {
      const entry = upsertMap.get(id);
      if (entry) {
        return {
          id: entry.id,
          type: entry.type,
          props: entry.props,
          children: entry.children.map(build),
        };
      }
      const old = oldIndex.get(id);
      if (old === undefined) {
        throw new Error(`applyPatch: unknown node id ${id} (stale base?)`);
      }
      if (!dirty.has(id)) return old; // unchanged subtree, shared
      return {
        id: old.id,
        type: old.type,
        props: old.props,
        children: old.children.map((child) => build(child.id)),
      };
    };
    return patch.root === null ? null : build(patch.root);
  }

  return { indexTree, countNodes, jsonEqual, diffTrees, buildPatch, applyPatch };
})();
