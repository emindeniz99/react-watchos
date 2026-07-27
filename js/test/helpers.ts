import type { ReactNode } from "react";
import { vi } from "vitest";
import type { HostBridge, WatchRoot } from "../src/index";
import {
  runApp,
  unregisterAllIntents,
  unregisterAllNativeListeners,
  unregisterAllWidgets,
} from "../src/index";
import { __resetSensorCountsForTest } from "../src/sensors";

// The query helpers are the public testing surface now; re-export so the
// existing suite exercises the same code consumers import.
export { findByText, findByType } from "../src/testing";

/** Roots mounted through `mountApp`, newest last. */
const mounted: WatchRoot[] = [];

/**
 * `runApp`, but the root is registered for teardown by `resetApp` — so a test
 * never has to remember to dispose, and `runApp`'s single-active-root guard
 * (ARCH-08) stays satisfied across cases in the same file.
 */
export function mountApp(element: ReactNode, host?: HostBridge): WatchRoot {
  const root = runApp(element, host);
  mounted.push(root);
  return root;
}

/**
 * The shared `afterEach` for any file that mounts an app: `afterEach(resetApp)`.
 *
 * Replaces the seven hand-written teardown blocks that each deleted a
 * different subset of the globals and reset a different subset of the module
 * registries (2026-06-25 review §F). It deliberately does NOT delete
 * `__dispatchEvent`/`__pushNativeEvent`/`__inspect` by hand: those belong to
 * the root that installed them and `dispose()` removes them, so a runApp call
 * that skipped `mountApp` fails loudly on the next mount instead of being
 * papered over here.
 *
 * `__host`/`__urlScheme` ARE deleted — Swift owns those on device, so no JS
 * root can uninstall them.
 */
export function resetApp(): void {
  // Reverse order: the newest root is torn down first, mirroring construction.
  //
  // A throwing effect cleanup must not abort the rest of the teardown — same
  // reasoning as WatchRoot.dispose()'s own `finally`: leaving the registries
  // and `__host` behind poisons the NEXT test in the file, which then fails
  // pointing at the wrong case. The first error is rethrown at the end, so the
  // teardown is still loud (rule 12) — just no longer partial. `failed` rather
  // than `failure ??= error` because a cleanup throwing a falsy value must
  // still rethrow.
  let failure: unknown;
  let failed = false;
  while (mounted.length > 0) {
    try {
      mounted.pop()?.dispose();
    } catch (error) {
      if (!failed) {
        failed = true;
        failure = error;
      }
    }
  }
  // Process registries. Module-scope registrations (registerIntent /
  // registerWidget) are NOT root-owned, which is exactly why dispose() leaves
  // them alone and this explicit reset exists.
  unregisterAllNativeListeners();
  unregisterAllIntents();
  unregisterAllWidgets();
  __resetSensorCountsForTest();
  const g = globalThis as Record<string, unknown>;
  delete g.__host;
  delete g.__urlScheme;
  if (failed) throw failure;
}

/**
 * Installs a fully-mocked `__host` global (every bridge method) and
 * returns it. Pair with `afterEach(resetApp)`, which removes it.
 */
export function installMockHost() {
  // Atomic counters (ARCH-05) are backed by a real Map so counterAdd actually
  // clamps + accumulates, mirroring CoordinatedCounterStore.
  const counters = new Map<string, number>();
  // ARCH-06: the monotonic App-Group state revision, mirroring the native
  // wiring so JS tests see real stamping — the FIRST write since the batch was
  // last closed bumps it (StateRevisionTracker's batching), and the bump happens
  // BEFORE the write lands (fail-stale ordering). Both publishing AND sampling
  // close the batch, so a write landing after a payload sampled the revision
  // always moves it past that payload's stamp.
  let revision = 0;
  let bumpedInThisBatch = false;
  const noteWrite = () => {
    if (bumpedInThisBatch) return;
    bumpedInThisBatch = true;
    revision += 1;
  };
  const closeBatch = () => {
    bumpedInThisBatch = false;
  };
  const host = {
    commit: vi.fn(),
    log: vi.fn(),
    setTimer: vi.fn(),
    clearTimer: vi.fn(),
    publishWidgets: vi.fn((_payloadJson: string) => {
      closeBatch();
    }),
    getItem: vi.fn((_key: string): string | null => null),
    setItem: vi.fn((_key: string, _value: string) => {
      noteWrite();
    }),
    stateRevision: vi.fn((): number => {
      closeBatch();
      return revision;
    }),
    counterGet: vi.fn((key: string): number => counters.get(key) ?? 0),
    counterAdd: vi.fn(
      (key: string, delta: number, min: number, max: number): number => {
        noteWrite();
        const next = Math.max(
          min,
          Math.min(max, (counters.get(key) ?? 0) + delta),
        );
        counters.set(key, next);
        return next;
      },
    ),
    playHaptic: vi.fn(),
    // Generic invoke channel (SD-1): dispatch by method and settle the Promise,
    // mirroring native. saveUpdate accepts, requestNotificationPermission grants;
    // an unrouted method rejects with UNKNOWN_METHOD. Tests wanting another
    // outcome call .mockImplementation or __resolveInvoke/__rejectInvoke directly.
    invoke: vi.fn((id: number, method: string, _payloadJson: string) => {
      const g = globalThis as {
        __resolveInvoke?: (id: number, resultJson: string) => void;
        __rejectInvoke?: (id: number, errorJson: string) => void;
      };
      if (method === "saveUpdate") {
        g.__resolveInvoke?.(id, JSON.stringify({ accepted: true }));
      } else if (method === "requestNotificationPermission") {
        g.__resolveInvoke?.(id, JSON.stringify("granted"));
      } else if (method === "registerForRemoteNotifications") {
        g.__resolveInvoke?.(id, JSON.stringify("a1b2c3d4e5f6"));
      } else if (method === "sendToPhone") {
        g.__resolveInvoke?.(id, JSON.stringify({ ok: true }));
      } else if (method === "scheduleNotification") {
        g.__resolveInvoke?.(id, "null");
      } else if (method === "getUpdateState") {
        g.__resolveInvoke?.(
          id,
          // Every field UpdateState declares required, mirroring the native
          // handler's shipped/zeroed defaults: the value crosses as JSON and is
          // cast by invoke<UpdateState>, so a short fixture type-checks while
          // handing every caller `undefined` for the ARCH-04 health fields.
          JSON.stringify({
            source: "shipped",
            highWater: 0,
            healthSignal: "commit",
            bootAttempts: 0,
          }),
        );
      } else if (
        method === "bleConnect" ||
        method === "bleWrite" ||
        method === "bleSubscribe" ||
        method === "updateApplicationContext" ||
        method === "transferUserInfo"
      ) {
        g.__resolveInvoke?.(id, ""); // success → resolves void
      } else {
        g.__rejectInvoke?.(
          id,
          JSON.stringify({ code: "UNKNOWN_METHOD", message: method }),
        );
      }
    }),
    cancelNotification: vi.fn(),
    fetch: vi.fn(),
    abortFetch: vi.fn(),
    ble: vi.fn(),
    sensor: vi.fn(),
    generate: vi.fn(),
  };
  (globalThis as Record<string, unknown>).__host = host;
  return host;
}
