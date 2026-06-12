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
  /**
   * Acknowledges the highest native event sequence number processed
   * before this commit. Native optimistic controls hold their local
   * value until the ack for their dispatch arrives, which kills the
   * stale-commit race on rapid interactions (Raycast solves the same
   * ordering problem with session ids over its IPC).
   */
  seq: number;
  root: SerializedNode | null;
}

export interface WatchEvent {
  nodeId: number;
  event: string;
  payload?: Record<string, unknown>;
  /** Native-assigned, monotonically increasing; echoed back via tree.seq. */
  seq?: number;
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
  /** App Group UserDefaults, shared between app and widget extension. */
  getItem?(key: string): string | null;
  setItem?(key: string, value: string): void;
  /** WKInterfaceDevice haptics. */
  playHaptic?(type: string): void;
  /** Local notifications (UNUserNotificationCenter). */
  requestNotificationPermission?(): void;
  scheduleNotification?(payloadJson: string): void;
  cancelNotification?(id: string): void;
}

/** The native bridge installed by JSRuntime/IntentRuntime, if present. */
export function getHost(): QuickJSHostGlobal | undefined {
  return (globalThis as { __host?: QuickJSHostGlobal }).__host;
}
