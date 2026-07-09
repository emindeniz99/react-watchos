/**
 * A lightweight remote inspector: in DEBUG, stream the serialized React tree
 * (via __inspect) and recent console logs to a browser viewer over the dev
 * network. Run `npm run inspector` and call `startInspector({ url })` from a
 * DEBUG build. Full React DevTools needs a WebSocket backend QuickJS lacks;
 * this gives you the live tree + logs with just the fetch shim.
 *
 * Logs are *also* visible in the Xcode console (console.log -> __host.log ->
 * Swift print); this adds a visual tree on top.
 */
const logs: string[] = [];
const MAX_LOGS = 200;
const errors: InspectorError[] = [];
const MAX_ERRORS = 50;
let started = false;
let teed = false;
let stopFn: (() => void) | null = null;

/** String(x) that never throws (null-prototype / throwing toString). */
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unserializable]";
  }
}

export function captureLog(line: string): void {
  logs.push(line);
  if (logs.length > MAX_LOGS) logs.shift();
}

/** A recorded error for the viewer's error panel. */
export interface InspectorError {
  message: string;
  /** The JS Error stack, when the captured value carried one. */
  stack?: string;
  /** React's componentStack (which subtree threw), when captured from an
   *  ErrorBoundary via `onError={captureError}`. */
  componentStack?: string;
}

/**
 * Record an error into the inspector's ring so the viewer can show WHERE the
 * app broke, not just that a log happened. Signature matches ErrorBoundary's
 * `onError`, so wiring is `<ErrorBoundary onError={captureError}>`; also fed by
 * the `console.error` tee. Never throws (defensive like the log tee).
 */
export function captureError(
  error: unknown,
  info?: { componentStack?: string | null },
): void {
  const e = error as { message?: unknown; stack?: unknown };
  const entry: InspectorError = {
    message: typeof e?.message === "string" ? e.message : safeString(error),
  };
  if (typeof e?.stack === "string") entry.stack = e.stack;
  if (info?.componentStack) entry.componentStack = info.componentStack;
  errors.push(entry);
  if (errors.length > MAX_ERRORS) errors.shift();
}

type Inspect = () => { commits: number; tree: unknown };

/** Snapshot the inspector sends to the viewer. */
export function inspectorSnapshot(): {
  commits: number;
  tree: unknown;
  logs: string[];
  errors: InspectorError[];
} {
  const inspect = (globalThis as { __inspect?: Inspect }).__inspect;
  const snap = inspect ? inspect() : { commits: 0, tree: null };
  return {
    commits: snap.commits,
    tree: snap.tree,
    logs: [...logs],
    errors: [...errors],
  };
}

export interface InspectorOptions {
  /** The `npm run inspector` server, e.g. http://127.0.0.1:8099/snapshot. */
  url: string;
  intervalMs?: number;
}

export function startInspector(options: InspectorOptions): () => void {
  // Already running: hand back the existing stop so a caller can still stop it.
  if (started) return stopFn ?? (() => {});
  started = true;

  // Tee console.log/console.error into the ring buffers once (a restart must
  // not re-wrap an already-wrapped console).
  if (!teed) {
    teed = true;
    const originalLog = (globalThis.console?.log ?? (() => {})) as (
      ...args: unknown[]
    ) => void;
    const originalError = (globalThis.console?.error ?? (() => {})) as (
      ...args: unknown[]
    ) => void;
    globalThis.console = {
      ...globalThis.console,
      log: (...args: unknown[]) => {
        // The tee must never break or alter the app's logging: run the real
        // console first, then capture defensively (safeString can't throw).
        originalLog(...args);
        try {
          captureLog(args.map(safeString).join(" "));
        } catch {}
      },
      error: (...args: unknown[]) => {
        originalError(...args);
        try {
          // Prefer a thrown Error's structure (keeps its stack) when it's the
          // sole argument; otherwise record the joined message.
          if (args.length === 1 && args[0] instanceof Error) {
            captureError(args[0]);
          } else {
            captureError({ message: args.map(safeString).join(" ") });
          }
        } catch {}
      },
    };
  }

  // `as unknown as` — the watch runtime's setInterval returns a numeric id,
  // but a consumer's @types/node types it as NodeJS.Timeout; assert our shape
  // through unknown so a consumer's `tsc` doesn't reject this file.
  const g = globalThis as unknown as {
    setInterval?: (fn: () => void, ms: number) => number;
    clearInterval?: (id: number) => void;
    fetch?: (url: string, init: unknown) => Promise<unknown>;
  };
  // Battery guards on a schedule that serializes the full tree every tick:
  // an unchanged snapshot (idle app) skips the POST entirely, and a server
  // that never answers stops the inspector after ~30 ticks instead of posting
  // into the void forever — the backstop for a startInspector() call shipped
  // by accident in a release bundle.
  let lastPosted: string | undefined;
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 30;
  const interval = g.setInterval?.(() => {
    const body = JSON.stringify(inspectorSnapshot());
    if (body === lastPosted) return;
    // Swallow network errors: when the inspector server isn't running, each
    // poll would otherwise reject and — via the runtime's promise-rejection
    // tracker — spam the dev overlay every interval.
    g.fetch?.(options.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
      ?.then(() => {
        lastPosted = body;
        consecutiveFailures = 0;
      })
      .catch(() => {
        consecutiveFailures += 1;
        // Stop THIS instance, not whatever stopFn currently points at: a
        // rejection settling after a stop+restart must not kill the
        // successor inspector.
        if (consecutiveFailures >= maxConsecutiveFailures) stop();
      });
  }, options.intervalMs ?? 1000);

  const stop = () => {
    if (interval !== undefined) g.clearInterval?.(interval);
    // Only the ACTIVE instance may release the singleton state; a late stop
    // from a superseded instance just clears its own (dead) interval.
    if (stopFn === stop) {
      started = false;
      stopFn = null;
    }
  };
  stopFn = stop;
  return stop;
}

/** Stops the running inspector poll (if any). Safe to call repeatedly; a later
 *  startInspector restarts it (optionally with changed options). */
export function stopInspector(): void {
  stopFn?.();
}
