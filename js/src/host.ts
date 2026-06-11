/**
 * The wire contract shared with the Swift side (NodeModel.swift /
 * JSRuntime.swift). Changing any of these shapes is a breaking change for
 * the watch app.
 */

export interface SerializedNode {
  id: number;
  type: string;
  props: Record<string, unknown>;
  children: SerializedNode[];
}

export interface SerializedTree {
  v: 1;
  root: SerializedNode | null;
}

export interface WatchEvent {
  nodeId: number;
  event: string;
  payload?: Record<string, unknown>;
}

/** Where committed trees go. Swift provides this via the `__host` global. */
export interface HostBridge {
  commit(tree: SerializedTree): void;
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

/**
 * Raw globals installed by JSRuntime.swift before the bundle is evaluated.
 * Strings cross the C boundary, so commit/event payloads are JSON strings.
 */
export interface QuickJSHostGlobal {
  commit(treeJson: string): void;
  log(message: string): void;
  setTimer(id: number, ms: number): void;
  clearTimer?(id: number): void;
  /** Persists rendered widget timelines and reloads WidgetKit. */
  publishWidgets?(payloadJson: string): void;
}
