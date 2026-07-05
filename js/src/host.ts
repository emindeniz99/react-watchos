// The wire contract is generated from codegen/schema.ts into one place;
// the Swift models (Generated/WireModel.swift) are generated from the same
// schema, so the two sides cannot drift. `QuickJSHostGlobal` (the raw `__host`
// surface) is generated too (CX-023) — from the same host-method signatures
// that produce the Swift `HostBridge` + C trampolines + install table.
export type {
  QuickJSHostGlobal,
  SerializedNode,
  SerializedTree,
  WatchEvent,
} from "./generated/wire";

import type { QuickJSHostGlobal, SerializedTree } from "./generated/wire";

/** Where committed trees go. Swift provides this via the `__host` global. */
export interface HostBridge {
  /**
   * `json` is the caller's already-serialized `tree` (the reconciler computes
   * it for no-op deduplication). The native bridge forwards that string
   * instead of re-stringifying; object hosts (tests) ignore it and use `tree`.
   */
  commit(tree: SerializedTree, json?: string): void;
  log?(message: string): void;
}

/** In-memory host for tests: records every committed tree. */
export class MemoryHost implements HostBridge {
  commits: SerializedTree[] = [];

  commit(tree: SerializedTree): void {
    this.commits.push(tree);
  }

  get lastCommit(): SerializedTree | undefined {
    return this.commits[this.commits.length - 1];
  }
}

/** The native bridge installed by JSRuntime/IntentRuntime, if present. */
export function getHost(): QuickJSHostGlobal | undefined {
  return (globalThis as { __host?: QuickJSHostGlobal }).__host;
}
