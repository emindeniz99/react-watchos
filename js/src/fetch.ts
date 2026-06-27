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
    const setTimeoutFn = (
      globalThis as {
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

interface FetchOptions {
  method?: string;
  headers?: HeadersInit;
  body?: string;
  signal?: WatchAbortSignal;
  /** Sugar: abort after this many ms (rejects with an AbortError). */
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
    signal?: WatchAbortSignal;
    onAbort?: () => void;
  }
  const pending = new Map<number, Pending>();

  const settle = (id: number): Pending | undefined => {
    const p = pending.get(id);
    if (!p) return undefined;
    pending.delete(id);
    if (p.signal && p.onAbort) p.signal.removeEventListener("abort", p.onAbort);
    // Cancel the timeout-sugar timer so it can't fire (and round-trip to the
    // native timer host) after the fetch already settled.
    if (p.signal?.timerId !== undefined) {
      (globalThis as { clearTimeout?: (id: number) => void }).clearTimeout?.(
        p.signal.timerId,
      );
      p.signal.timerId = undefined;
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
      const signal =
        options?.signal ??
        (options?.timeout
          ? WatchAbortSignal.timeout(options.timeout)
          : undefined);
      if (signal?.aborted) {
        reject(signalReason(signal));
        return;
      }
      const id = nextId++;
      const entry: Pending = { resolve, reject };
      if (signal) {
        entry.signal = signal;
        entry.onAbort = () => {
          if (settle(id)) {
            g.__host?.abortFetch?.(id);
            reject(signalReason(signal));
          }
        };
        signal.addEventListener("abort", entry.onAbort);
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
