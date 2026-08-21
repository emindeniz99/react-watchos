import { vi } from "vitest";

// The public testing surface carries the whole harness — re-export the parts
// the suite reaches for through this file, so those tests exercise exactly the
// code consumers import. `installInvokeHost` / `pushDeepLink` are deliberately
// NOT re-exported: their only consumer (testing-helpers.test.tsx) imports them
// straight from ../src/testing, which is the more honest pinning of the public
// surface anyway.
export {
  findByText,
  findByType,
  mountApp,
  resetApp,
} from "../src/testing";

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
        method === "transferUserInfo" ||
        method === "cancelFileTransfer" ||
        method === "deleteReceivedFile"
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
