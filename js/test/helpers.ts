import { vi } from "vitest";
import { installInvokeHost } from "../src/testing";

// The public testing surface carries the whole harness — re-export the parts
// the suite reaches for through this file, so those tests exercise exactly the
// code consumers import. `installInvokeHost` / `pushDeepLink` are deliberately
// NOT re-exported: their direct consumer (testing-helpers.test.tsx) imports
// them straight from ../src/testing, which is the more honest pinning of the
// public surface anyway (`installMockHost` below USES installInvokeHost, so
// every mock-host test exercises the published settle wire regardless).
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
  // Generic invoke channel (SD-1): the PUBLISHED auto-settle host, not a
  // second implementation of the settle wire (one implementation, published —
  // this mock rides exactly what consumers get). Canned outcomes mirror the
  // native handlers' defaults; the "*" wildcard mirrors native's reply for an
  // unrouted method, so a test touching an unlisted method fails loudly
  // instead of silently succeeding. Tests wanting another outcome call
  // .mockImplementation or __resolveInvoke/__rejectInvoke directly.
  const invokeChannel = installInvokeHost({
    saveUpdate: { accepted: true },
    requestNotificationPermission: "granted",
    registerForRemoteNotifications: "a1b2c3d4e5f6",
    sendToPhone: { ok: true },
    scheduleNotification: null,
    // Every field UpdateState declares required, mirroring the native
    // handler's shipped/zeroed defaults: the value crosses as JSON and is
    // cast by invoke<UpdateState>, so a short fixture type-checks while
    // handing every caller `undefined` for the ARCH-04 health fields.
    getUpdateState: {
      source: "shipped",
      highWater: 0,
      healthSignal: "commit",
      bootAttempts: 0,
    },
    // success → resolves void (LISTED as undefined, so these settle instead
    // of falling through to the wildcard)
    bleConnect: undefined,
    bleWrite: undefined,
    bleSubscribe: undefined,
    updateApplicationContext: undefined,
    transferUserInfo: undefined,
    cancelFileTransfer: undefined,
    deleteReceivedFile: undefined,
    "*": (_payload: unknown, method: string) => {
      throw { code: "UNKNOWN_METHOD", message: method };
    },
  });
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
    invoke: vi.fn(invokeChannel.host.invoke),
    cancelNotification: vi.fn(),
    fetch: vi.fn(),
    abortFetch: vi.fn(),
    ble: vi.fn(),
    sensor: vi.fn(),
    generate: vi.fn(),
  };
  // Replaces the invoke-only `__host` installInvokeHost just installed with the
  // full mock — the graft the InvokeHost.host doc describes. The channel keeps
  // working because `invoke` is the same function; resetApp removes whichever
  // host is current.
  (globalThis as Record<string, unknown>).__host = host;
  return host;
}
