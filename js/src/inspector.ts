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

export function startInspector(options: InspectorOptions): void {
  if (started) return;
  started = true;

  // Tee console.log into the ring buffer (still forwards to the host).
  const original = (globalThis.console?.log ?? (() => {})) as (
    ...args: unknown[]
  ) => void;
  globalThis.console = {
    ...globalThis.console,
    log: (...args: unknown[]) => {
      captureLog(args.map(String).join(" "));
      original(...args);
    },
  };

  const g = globalThis as {
    setInterval?: (fn: () => void, ms: number) => unknown;
    fetch?: (url: string, init: unknown) => Promise<unknown>;
  };
  g.setInterval?.(() => {
    const body = JSON.stringify(inspectorSnapshot());
    g.fetch?.(options.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  }, options.intervalMs ?? 1000);
}
