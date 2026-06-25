// The wire contract is generated from codegen/schema.mjs into one place;
// the Swift models (Generated/WireModel.swift) are generated from the same
// schema, so the two sides cannot drift.
export type {
  SerializedNode,
  SerializedTree,
  WatchEvent,
} from "./generated/wire";

import type { SerializedTree } from "./generated/wire";

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
  /**
   * Asks for notification permission; settles via __resolveNotificationPermission
   * (id, status) / __rejectNotificationPermission (id, message) so JS learns the
   * real authorization status — not just a Bool, which can't tell `.provisional`
   * (silently granted) from a full grant (CX-022).
   */
  requestNotificationPermission?(id: number): void;
  scheduleNotification?(payloadJson: string): void;
  cancelNotification?(id: string): void;
  /** WatchConnectivity: send a message to the paired iPhone. */
  sendToPhone?(json: string): void;
  /** Async HTTP via URLSession; settles via __resolveFetch/__rejectFetch. */
  fetch?(id: number, requestJson: string): void;
  /** Cancel an in-flight fetch by id (AbortController/timeout). */
  abortFetch?(id: number): void;
  /** CoreBluetooth central ops: { op, ... }. Events arrive as native pushes. */
  ble?(json: string): void;
  /** Sensor streams (HealthKit/CoreMotion): { op, kind }. Readings push back. */
  sensor?(json: string): void;
  /**
   * Persists an OTA JS bundle (loaded next launch). Fallible — settles via
   * __resolveSaveUpdate(id, resultJson) / __rejectSaveUpdate(id, errorJson) so
   * applyUpdate learns whether the update was accepted (CX-005).
   */
  saveUpdate?(id: number, requestJson: string): void;
  /** On-device LLM (Foundation Models); settles via __resolveGenerate/__rejectGenerate. */
  generate?(id: number, requestJson: string): void;
}

/** The native bridge installed by JSRuntime/IntentRuntime, if present. */
export function getHost(): QuickJSHostGlobal | undefined {
  return (globalThis as { __host?: QuickJSHostGlobal }).__host;
}
