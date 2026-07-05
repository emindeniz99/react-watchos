import type { QuickJSHostGlobal } from "./host";

/**
 * A focused fetch for QuickJS (no native fetch/XHR on the watch) — a deliberate
 * WHATWG *subset*, not the full API. React Native ships the whatwg-fetch
 * polyfill over XMLHttpRequest; we don't have XHR/Blob/FormData and don't want
 * their weight on a watch, so this implements the parts that matter:
 *   - a case-insensitive `Headers` class;
 *   - `AbortController`/`AbortSignal` cancellation (the standard way; `timeout`
 *     is sugar over it);
 *   - a `Response` with status/statusText/ok/url/headers and a single-use body
 *     (`bodyUsed`; the first text()/json()/arrayBuffer() consumes it).
 * Text bodies are strings (decode/encode JSON yourself); binary bodies arrive
 * base64-encoded (`bodyEncoding === "base64"`) — read them with arrayBuffer(),
 * since text()/json() reject on binary rather than return a silently-wrong
 * value. Oversized bodies are rejected by the host before they reach here.
 *
 * The URL scheme is NOT restricted here: the request string is passed verbatim
 * to native, where `FetchPlan` + URLSession decide what can actually be fetched
 * (they accept any absolute URL and reject the rest) — that's the single
 * authority, so a custom app scheme works iff URLSession supports it.
 *
 * Intentionally NOT implemented (the host can't honor them, so faking them would
 * mislead): `Request` input, `clone()`, `credentials`/`cache`/`redirect`,
 * `Blob`/`FormData`.
 *
 * Wire: __host.fetch(id, requestJson) arms an async URLSession request;
 * Swift settles it on the main thread via __resolveFetch/__rejectFetch, and
 * __host.abortFetch(id) cancels an in-flight request.
 */

type HeadersInit = Headers | Record<string, string> | Array<[string, string]>;

/** HTTP header names are case-insensitive — store and look up lowercased. */
export class Headers {
  private map = new Map<string, string>();

  constructor(init?: HeadersInit) {
    if (init instanceof Headers) {
      init.forEach((value, key) => {
        this.set(key, value);
      });
    } else if (Array.isArray(init)) {
      for (const [key, value] of init) this.append(key, value);
    } else if (init) {
      for (const [key, value] of Object.entries(init)) this.set(key, value);
    }
  }

  get(name: string): string | null {
    return this.map.get(name.toLowerCase()) ?? null;
  }
  has(name: string): boolean {
    return this.map.has(name.toLowerCase());
  }
  set(name: string, value: string): void {
    this.map.set(name.toLowerCase(), String(value));
  }
  append(name: string, value: string): void {
    const key = name.toLowerCase();
    const existing = this.map.get(key);
    this.map.set(key, existing ? `${existing}, ${value}` : String(value));
  }
  delete(name: string): void {
    this.map.delete(name.toLowerCase());
  }
  forEach(cb: (value: string, key: string, parent: Headers) => void): void {
    this.map.forEach((value, key) => {
      cb(value, key, this);
    });
  }
  toJSON(): Record<string, string> {
    const out: Record<string, string> = {};
    this.map.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
}

function abortError(message = "The operation was aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

class WatchAbortSignal {
  aborted = false;
  reason: unknown = undefined;
  private listeners = new Set<() => void>();
  /**
   * The timer id for a `.timeout()` signal, so fetch can cancel it once the
   * response arrives — otherwise it fires (and round-trips to the native timer
   * host) after the fetch already settled. Undefined for a controller signal.
   */
  timerId: number | undefined = undefined;

  addEventListener(type: string, cb: () => void): void {
    if (type === "abort") this.listeners.add(cb);
  }
  removeEventListener(_type: string, cb: () => void): void {
    this.listeners.delete(cb);
  }
  throwIfAborted(): void {
    if (this.aborted) throw this.reason;
  }
  /** internal */
  fire(reason: unknown): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason;
    this.listeners.forEach((l) => {
      l();
    });
    this.listeners.clear();
  }

  static timeout(ms: number): WatchAbortSignal {
    const signal = new WatchAbortSignal();
    const setTimeoutFn =
      // `as unknown as` — the watch runtime's setTimeout returns a numeric id,
      // but a consumer's @types/node types it as NodeJS.Timeout; assert our
      // shape through unknown so a consumer's `tsc` doesn't reject this file.
      (
        globalThis as unknown as {
          setTimeout?: (fn: () => void, ms: number) => number;
        }
      ).setTimeout;
    signal.timerId = setTimeoutFn?.(
      () => signal.fire(abortError(`timeout after ${ms}ms`)),
      ms,
    );
    return signal;
  }
}

class WatchAbortController {
  readonly signal = new WatchAbortSignal();
  abort(reason?: unknown): void {
    this.signal.fire(reason ?? abortError());
  }
}

type Global = Record<string, unknown> & { __host?: QuickJSHostGlobal };

/** Last-resort watchdog when no `timeout:` is given — a fetch must never hang
 *  forever (invoke=30s / generate=60s follow the same invariant). Generous vs
 *  the 5 MiB body cap on a watch network; `timeout: Infinity` opts out. */
const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

interface FetchOptions {
  method?: string;
  headers?: HeadersInit;
  body?: string;
  signal?: WatchAbortSignal;
  /** Abort after this many ms (rejects with an AbortError). Composes with
   *  `signal` — whichever aborts first wins. Defaults to the 120 s watchdog;
   *  pass `Infinity` for no time limit. */
  timeout?: number;
}

interface RawResponse {
  status?: number;
  statusText?: string;
  url?: string;
  redirected?: boolean;
  headers?: Record<string, string>;
  body?: string;
  /** "utf8" (body is text) or "base64" (body is a base64-encoded binary). */
  bodyEncoding?: "utf8" | "base64";
}

function signalReason(signal: WatchAbortSignal): unknown {
  return signal.reason ?? abortError();
}

/** Decode base64 → bytes. `atob` is a QuickJS global (JS_AddIntrinsicAToB). */
function base64ToBytes(b64: string): Uint8Array {
  const binary = (globalThis as { atob: (s: string) => string }).atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** UTF-8 encode a string → bytes. QuickJS has no TextEncoder, so do it by
 *  hand for arrayBuffer() on text bodies. */
function utf8ToBytes(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (lo & 0x3ff);
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

/** Installs fetch + Headers + AbortController if the engine lacks fetch. */
export function installFetch(g: Global): void {
  if (typeof g.fetch === "function") return;

  g.Headers = Headers;
  g.AbortController = WatchAbortController;
  g.AbortSignal = WatchAbortSignal;

  let nextId = 1;
  interface Pending {
    resolve: (response: unknown) => void;
    reject: (error: unknown) => void;
    /** The caller's signal, if any — shared, so only the listener is removed. */
    signal?: WatchAbortSignal | undefined;
    /** The watchdog signal this fetch CREATED (from `timeout:` or the default
     *  cap) — always fetch-owned, so settle tears its timer down too. It
     *  composes with `signal`: whichever aborts first settles the fetch. */
    timeoutSignal?: WatchAbortSignal | undefined;
    onAbort?: () => void;
  }
  const pending = new Map<number, Pending>();

  const settle = (id: number): Pending | undefined => {
    const p = pending.get(id);
    if (!p) return undefined;
    pending.delete(id);
    if (p.onAbort) {
      p.signal?.removeEventListener("abort", p.onAbort);
      p.timeoutSignal?.removeEventListener("abort", p.onAbort);
    }
    // Cancel the owned watchdog timer so it can't fire (and round-trip to the
    // native timer host) after the fetch already settled. The caller's signal
    // may be shared across fetches — its timer (if any) is left alone.
    if (p.timeoutSignal?.timerId !== undefined) {
      (globalThis as { clearTimeout?: (id: number) => void }).clearTimeout?.(
        p.timeoutSignal.timerId,
      );
      p.timeoutSignal.timerId = undefined;
    }
    return p;
  };

  const makeResponse = (r: RawResponse) => {
    const status = r.status ?? 0;
    const body = r.body ?? "";
    const binary = r.bodyEncoding === "base64";
    // A binary body can't be UTF-8-decoded without a TextDecoder QuickJS
    // lacks; rather than hand back a silently-wrong string, reject text()/
    // json() and steer the caller to arrayBuffer().
    const binaryError = () =>
      new TypeError("binary response body; read it with arrayBuffer()");
    // WHATWG: a body is consumed once. The first reader locks it; a second
    // read rejects (CX-021). `consume()` claims the body or returns false.
    // (The binary guard is checked first, so text()/json() on a binary body
    // always reject with the more useful binaryError, used or not.)
    let bodyUsed = false;
    const consume = (): boolean => {
      if (bodyUsed) return false;
      bodyUsed = true;
      return true;
    };
    const usedError = () => new TypeError("body already consumed");
    return {
      status,
      statusText: r.statusText ?? "",
      ok: status >= 200 && status < 300,
      url: r.url ?? "",
      redirected: r.redirected ?? false,
      headers: new Headers(r.headers),
      bodyEncoding: r.bodyEncoding ?? "utf8",
      get bodyUsed() {
        return bodyUsed;
      },
      text: () => {
        if (binary) return Promise.reject(binaryError());
        if (!consume()) return Promise.reject(usedError());
        return Promise.resolve(body);
      },
      json: () => {
        if (binary) return Promise.reject(binaryError());
        if (!consume()) return Promise.reject(usedError());
        try {
          return Promise.resolve(JSON.parse(body || "null"));
        } catch (error) {
          return Promise.reject(error);
        }
      },
      arrayBuffer: () => {
        if (!consume()) return Promise.reject(usedError());
        return Promise.resolve(
          (binary ? base64ToBytes(body) : utf8ToBytes(body)).buffer,
        );
      },
    };
  };

  g.fetch = (url: string, options?: FetchOptions): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted) {
        reject(signalReason(signal));
        return;
      }
      // Fail loud, don't hang: without a fetch-capable host the native call
      // would be a silent no-op and this promise (+ pending entry + abort
      // listener) would leak for the runtime's life (CX-022). Mirror invoke's
      // UNAVAILABLE guard — reject BEFORE allocating any state.
      if (!g.__host?.fetch) {
        reject(
          new TypeError(
            `fetch unavailable: host has no fetch (cannot request ${url})`,
          ),
        );
        return;
      }
      // The watchdog: `timeout:` when given, else a last-resort default so a
      // fetch can NEVER hang forever (the "never hangs" invariant invoke=30s /
      // generate=60s already follow — fetch was the ∞ outlier). It COMPOSES
      // with a caller signal instead of being dropped by it: whichever aborts
      // first wins. `timeout: Infinity` opts out of the watchdog explicitly.
      // Created AFTER the early rejects so they can't leak an armed timer.
      const timeoutMs = options?.timeout ?? DEFAULT_FETCH_TIMEOUT_MS;
      const timeoutSignal = Number.isFinite(timeoutMs)
        ? WatchAbortSignal.timeout(timeoutMs)
        : undefined;
      const id = nextId++;
      const entry: Pending = { resolve, reject };
      if (signal || timeoutSignal) {
        entry.signal = signal;
        entry.timeoutSignal = timeoutSignal;
        entry.onAbort = () => {
          if (settle(id)) {
            g.__host?.abortFetch?.(id);
            // Report whichever signal actually fired (the caller's abort
            // reason, or the watchdog's timeout error).
            reject(
              signal?.aborted
                ? signalReason(signal)
                : signalReason(timeoutSignal as WatchAbortSignal),
            );
          }
        };
        signal?.addEventListener("abort", entry.onAbort);
        timeoutSignal?.addEventListener("abort", entry.onAbort);
      }
      pending.set(id, entry);
      g.__host?.fetch?.(
        id,
        JSON.stringify({
          url,
          method: (options?.method ?? "GET").toUpperCase(),
          headers: new Headers(options?.headers).toJSON(),
          body: options?.body ?? null,
        }),
      );
    });

  g.__resolveFetch = (id: number, responseJson: string) => {
    const p = settle(id);
    if (!p) return;
    try {
      p.resolve(makeResponse(JSON.parse(responseJson)));
    } catch (error) {
      p.reject(error);
    }
  };

  // WHATWG fetch rejects network failures with a TypeError.
  g.__rejectFetch = (id: number, message: string) => {
    const p = settle(id);
    if (!p) return;
    p.reject(new TypeError(message));
  };
}
