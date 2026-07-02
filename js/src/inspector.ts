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
let started = false;
let teed = false;
let stopFn: (() => void) | null = null;

export function captureLog(line: string): void {
  logs.push(line);
  if (logs.length > MAX_LOGS) logs.shift();
}

type Inspect = () => { commits: number; tree: unknown };

/** Snapshot the inspector sends to the viewer. */
export function inspectorSnapshot(): {
  commits: number;
  tree: unknown;
  logs: string[];
} {
  const inspect = (globalThis as { __inspect?: Inspect }).__inspect;
  const snap = inspect ? inspect() : { commits: 0, tree: null };
  return { commits: snap.commits, tree: snap.tree, logs: [...logs] };
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

  // Tee console.log into the ring buffer once (a restart must not re-wrap an
  // already-wrapped console).
  if (!teed) {
    teed = true;
    const original = (globalThis.console?.log ?? (() => {})) as (
      ...args: unknown[]
    ) => void;
    globalThis.console = {
      ...globalThis.console,
      log: (...args: unknown[]) => {
        // The tee must never break or alter the app's logging: run the real
        // console first, then capture defensively — String(x) throws for a
        // null-prototype object or a throwing toString, which would otherwise
        // propagate out of console.log to the caller.
        original(...args);
        try {
          captureLog(
            args
              .map((a) => {
                try {
                  return String(a);
                } catch {
                  return "[unserializable]";
                }
              })
              .join(" "),
          );
        } catch {}
      },
    };
  }

  const g = globalThis as {
    setInterval?: (fn: () => void, ms: number) => number;
    clearInterval?: (id: number) => void;
    fetch?: (url: string, init: unknown) => Promise<unknown>;
  };
  const interval = g.setInterval?.(() => {
    const body = JSON.stringify(inspectorSnapshot());
    // Swallow network errors: when the inspector server isn't running, each
    // poll would otherwise reject and — via the runtime's promise-rejection
    // tracker — spam the dev overlay every interval.
    g.fetch?.(options.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })?.catch?.(() => {});
  }, options.intervalMs ?? 1000);

  stopFn = () => {
    if (interval !== undefined) g.clearInterval?.(interval);
    started = false;
    stopFn = null;
  };
  return stopFn;
}

/** Stops the running inspector poll (if any). Safe to call repeatedly; a later
 *  startInspector restarts it (optionally with changed options). */
export function stopInspector(): void {
  stopFn?.();
}
