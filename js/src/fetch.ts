import type { QuickJSHostGlobal } from "./host";

/**
 * A focused, WHATWG-aligned fetch for QuickJS (no native fetch/XHR on the
 * watch). React Native ships the full whatwg-fetch polyfill over
 * XMLHttpRequest over native networking; we don't have XHR/Blob/FormData
 * and don't want their weight on a watch, so this implements the parts that
 * matter: a case-insensitive Headers class, AbortController/AbortSignal
 * cancellation (the standard way; `timeout` is sugar over it), and a
 * Response with status/statusText/ok/url/headers/text()/json(). Bodies are
 * strings (decode/encode JSON yourself).
 *
 * Wire: __host.fetch(id, requestJson) arms an async URLSession request;
 * Swift settles it on the main thread via __resolveFetch/__rejectFetch, and
 * __host.abortFetch(id) cancels an in-flight request.
 */

type HeadersInit =
  | Headers
  | Record<string, string>
  | Array<[string, string]>;

/** HTTP header names are case-insensitive — store and look up lowercased. */
export class Headers {
  private map = new Map<string, string>();

  constructor(init?: HeadersInit) {
    if (init instanceof Headers) {
      init.forEach((value, key) => this.set(key, value));
    } else if (Array.isArray(init)) {
      for (const [key, value] of init) this.append(key, value);
    } else if (init) {
      for (const key of Object.keys(init)) this.set(key, init[key]);
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
    this.map.forEach((value, key) => cb(value, key, this));
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
    this.listeners.forEach((l) => l());
    this.listeners.clear();
  }

  static timeout(ms: number): WatchAbortSignal {
    const signal = new WatchAbortSignal();
    const setTimeoutFn = (globalThis as {
      setTimeout?: (fn: () => void, ms: number) => number;
    }).setTimeout;
    setTimeoutFn?.(() => signal.fire(abortError(`timeout after ${ms}ms`)), ms);
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
}

function signalReason(signal: WatchAbortSignal): unknown {
  return signal.reason ?? abortError();
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
    return p;
  };

  const makeResponse = (r: RawResponse) => {
    const status = r.status ?? 0;
    const body = r.body ?? "";
    return {
      status,
      statusText: r.statusText ?? "",
      ok: status >= 200 && status < 300,
      url: r.url ?? "",
      redirected: r.redirected ?? false,
      headers: new Headers(r.headers),
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body || "null")),
    };
  };

  g.fetch = (url: string, options?: FetchOptions): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const signal =
        options?.signal ??
        (options?.timeout ? WatchAbortSignal.timeout(options.timeout) : undefined);
      if (signal?.aborted) {
        reject(signalReason(signal));
        return;
      }
      const id = nextId++;
      const entry: Pending = { resolve, reject, signal };
      if (signal) {
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
