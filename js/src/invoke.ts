import { getHost } from "./host";

/**
 * Generic request/response bridge for fallible native ops (SD-1 / CX-022).
 * Instead of a `__resolve*`/`__reject*` global pair per op, one channel:
 * `__host.invoke(id, method, payloadJson)` is settled by
 * `__resolveInvoke(id, resultJson)` / `__rejectInvoke(id, errorJson)`. Mirrors
 * the Capacitor/React-Native bridge model (one correlation-keyed map, settle
 * exactly once). Streaming ops (sensor/BLE notifications) keep the push channel;
 * `fetch` (abort/large body) and `generate` keep their dedicated paths.
 */

/** Closed set of error codes the native side may reject an invoke with.
 *  `POLICY_DENIED` (ARCH-07): the binary backs the method's feature but the
 *  app's HostPolicy doesn't authorize it — fixable only by an app
 *  configuration change (a native release), unlike `PERMISSION_DENIED`
 *  (the user) or `UNAVAILABLE` (the binary/runtime). */
export type InvokeErrorCode =
  | "UNKNOWN_METHOD"
  | "PERMISSION_DENIED"
  | "POLICY_DENIED"
  | "UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INTERNAL";

/** Error thrown by a rejected invoke; `code` is machine-switchable. */
export interface InvokeError extends Error {
  code: InvokeErrorCode;
}

/**
 * The runtime half of the closed set. `settle()` used to do
 * `code = parsed.code as InvokeErrorCode` — an unchecked cast, so ANY native
 * string landed in `error.code` and TypeScript endorsed it: `playAudio` once
 * rejected `"AUDIO_FAILED"` and `getCurrentLocation` `"LOCATION_UNAVAILABLE"`,
 * and no `if (e.code === "UNAVAILABLE")` could ever match either. The Swift
 * side is now an enum (`InvokeErrorCode` in ReactWatchSupport), so this is the
 * belt to that braces — a code from an older/other binary degrades to
 * `INTERNAL` instead of lying about the union.
 *
 * A `Record` keyed by the union, not a `Set`: adding a member to
 * `InvokeErrorCode` without adding it here fails to compile.
 */
const INVOKE_ERROR_CODES: Record<InvokeErrorCode, true> = {
  UNKNOWN_METHOD: true,
  PERMISSION_DENIED: true,
  POLICY_DENIED: true,
  UNAVAILABLE: true,
  INVALID_REQUEST: true,
  INTERNAL: true,
};

/** Index rather than `in`/`hasOwn` so an inherited key ("constructor",
 *  "toString") can't answer true. */
function isInvokeErrorCode(value: string): value is InvokeErrorCode {
  return INVOKE_ERROR_CODES[value as InvokeErrorCode] === true;
}

function invokeError(code: InvokeErrorCode, message: string): InvokeError {
  const error = new Error(message) as InvokeError;
  error.code = code;
  return error;
}

let nextInvokeId = 1;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

/**
 * Last-resort settle when native accepts an invoke and then never replies (an
 * exception before the callback, a dropped delegate). Every native path is
 * supposed to settle exactly once (CX-022), but that invariant depends on
 * each bridge author's diligence — without this net, one miss hangs the JS
 * promise and leaks its closures for the runtime's life. Paths with tighter
 * native semantics (BLE connect's 15 s) settle first and win.
 */
const INVOKE_TIMEOUT_MS = 30_000;

/**
 * Watchdog bound for user-mediated ops (permission prompt, StoreKit purchase):
 * their native callback intentionally blocks on the user answering a system
 * sheet, which routinely outlasts the 30 s default — a blanket watchdog would
 * falsely reject a granted permission or a completed purchase. 5 min still
 * bounds a genuinely stuck bridge (the never-hangs guarantee holds), it just
 * doesn't mistake a deliberating user for a hang.
 */
export const USER_MEDIATED_INVOKE_TIMEOUT_MS = 5 * 60_000;

/** Per-call overrides. `timeoutMs` raises the last-resort watchdog for
 *  user-mediated ops (see {@link USER_MEDIATED_INVOKE_TIMEOUT_MS}). */
export interface InvokeOptions {
  timeoutMs?: number;
}

/** The single settle path — drops the id from the pending map FIRST, so a
 *  duplicate native reply for the same id is a silent no-op (settle once). */
function settle(id: number, ok: boolean, json: string): void {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  if (ok) {
    try {
      entry.resolve(json ? JSON.parse(json) : undefined);
    } catch (error) {
      entry.reject(error);
    }
    return;
  }
  let code: InvokeErrorCode = "INTERNAL";
  let message = "native error";
  try {
    const parsed = json ? JSON.parse(json) : {};
    if (typeof parsed.message === "string") message = parsed.message;
    if (typeof parsed.code === "string") {
      if (isInvokeErrorCode(parsed.code)) {
        code = parsed.code;
      } else {
        // Unrecognized: report INTERNAL (the honest "we don't know") but keep
        // the original spelling in the message so the native bug is
        // diagnosable from a crash report instead of erased.
        message = `${parsed.code}: ${message}`;
      }
    }
  } catch {}
  entry.reject(invokeError(code, message));
}

/** Installs the host->JS settle globals; called lazily by invoke so they
 *  exist before the host replies. Assigns UNCONDITIONALLY (most-recent
 *  evaluation wins): a same-context reload/OTA re-eval runs this module's
 *  top level again with a FRESH `pending` map, but `globalThis` survives the
 *  re-eval. An early-return-if-present guard would leave the OLD bundle's
 *  closures (over the OLD `pending`) installed forever — every invoke from
 *  the NEW bundle then arms a NEW pending entry that no installed settle
 *  function can ever find, so it silently hangs until its 30s watchdog. */
function installInvokeBridge(): void {
  const g = globalThis as {
    __resolveInvoke?: (id: number, resultJson: string) => void;
    __rejectInvoke?: (id: number, errorJson: string) => void;
  };
  g.__resolveInvoke = (id, resultJson) => settle(id, true, resultJson);
  g.__rejectInvoke = (id, errorJson) => settle(id, false, errorJson);
}

/**
 * Calls a fallible native op and resolves its typed result. Rejects with an
 * {@link InvokeError} carrying a machine `code` — `UNAVAILABLE` when there's no
 * invoke-capable host (tests/widget), `UNKNOWN_METHOD` when the native side has
 * no handler, etc. Never hangs: an unrouted method rejects rather than leaving
 * the promise pending.
 */
export function invoke<T = unknown>(
  method: string,
  payload?: unknown,
  options?: InvokeOptions,
): Promise<T> {
  const host = getHost();
  if (!host?.invoke) {
    return Promise.reject(
      invokeError(
        "UNAVAILABLE",
        `host.invoke unavailable (cannot call ${method})`,
      ),
    );
  }
  // Serialize BEFORE arming the timer / pending entry: a non-serializable
  // payload (BigInt, circular ref) must reject cleanly, not orphan a 30s timer
  // + pending entry that only clear when the timeout fires (CX-022 no-leak).
  let payloadJson: string;
  try {
    payloadJson = payload === undefined ? "" : JSON.stringify(payload);
  } catch (error) {
    return Promise.reject(
      invokeError(
        "INVALID_REQUEST",
        `${method} payload not serializable: ${(error as Error).message}`,
      ),
    );
  }
  installInvokeBridge();
  const timeoutMs = options?.timeoutMs ?? INVOKE_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    const id = nextInvokeId++;
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(
        invokeError(
          "INTERNAL",
          `${method} got no native reply within ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timer,
    });
    host.invoke?.(id, method, payloadJson);
  });
}
