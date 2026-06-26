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

/** Closed set of error codes the native side may reject an invoke with. */
export type InvokeErrorCode =
  | "UNKNOWN_METHOD"
  | "PERMISSION_DENIED"
  | "UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INTERNAL";

/** Error thrown by a rejected invoke; `code` is machine-switchable. */
export interface InvokeError extends Error {
  code: InvokeErrorCode;
}

function invokeError(code: InvokeErrorCode, message: string): InvokeError {
  const error = new Error(message) as InvokeError;
  error.code = code;
  return error;
}

let nextInvokeId = 1;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: unknown) => void }
>();

/** The single settle path — drops the id from the pending map FIRST, so a
 *  duplicate native reply for the same id is a silent no-op (settle once). */
function settle(id: number, ok: boolean, json: string): void {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
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
    if (typeof parsed.code === "string") code = parsed.code as InvokeErrorCode;
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {}
  entry.reject(invokeError(code, message));
}

/** Installs the host->JS settle globals (idempotent); called lazily by invoke
 *  so they exist before the host replies. */
function installInvokeBridge(): void {
  const g = globalThis as {
    __resolveInvoke?: (id: number, resultJson: string) => void;
    __rejectInvoke?: (id: number, errorJson: string) => void;
  };
  if (g.__resolveInvoke) return;
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
  installInvokeBridge();
  return new Promise<T>((resolve, reject) => {
    const id = nextInvokeId++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    host.invoke?.(
      id,
      method,
      payload === undefined ? "" : JSON.stringify(payload),
    );
  });
}
