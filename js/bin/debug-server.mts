/**
 * `react-watchos debug` — the dev-server half of the source-level debugger
 * (docs/design-dap-debugger.md). Two listeners over one {@link DapSession}:
 *
 *   TCP  <dapPort>        DAP, Content-Length framed. VS Code attaches with
 *                         `{"type":"node","debugServer":<dapPort>}` — the
 *                         `debugServer` escape hatch means no extension has to
 *                         be written or installed for this spike.
 *   HTTP <port>/debug/poll  the watch's blocking exchange: it POSTs its state
 *                         (running, or paused with frames) and gets the next
 *                         command back.
 *
 * The HTTP side LONG-POLLS: a paused watch is spinning in a synchronous host
 * call, so answering "nothing yet" immediately would turn a developer reading
 * their code into a busy loop on the watch's main thread. The request is held
 * until the session has something to say or ~1 s passes.
 *
 * Why a second port rather than reusing `react-watchos dev` (8788): that server
 * is esbuild's own (`ctx.serve`), which serves a directory and has no hook for
 * a POST endpoint. Sharing it would mean putting a proxy in front of esbuild's
 * server for one route.
 */

import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type Socket } from "node:net";
import {
  DEBUG_MANIFEST_VERSION,
  type DebugManifest,
} from "../esbuild/debug-probe.mts";
import type { ProbeCommand, ProbeState } from "../src/debugWire.ts";
import { type DapMessage, DapSession } from "./dap-session.mts";

/** How long a paused watch's exchange is held open before answering "nothing". */
const LONG_POLL_MS = 1000;
/** How often the held request re-checks the session. */
const LONG_POLL_TICK_MS = 20;

/** Encode one DAP message with the base protocol's `Content-Length` header. */
export function encodeDapMessage(message: DapMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
    body,
  ]);
}

/**
 * Incremental decoder for the DAP base protocol. Header bytes are ASCII, the
 * body is UTF-8, and `Content-Length` counts BYTES — so this buffers Buffers,
 * not strings: a single multi-byte character split across two TCP chunks would
 * otherwise make every subsequent frame boundary wrong.
 */
export class DapDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer, onMessage: (message: DapMessage) => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match?.[1]) {
        // Unframeable input: drop the bad header rather than desynchronizing
        // every message after it.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      try {
        onMessage(JSON.parse(body) as DapMessage);
      } catch {
        // A malformed body is the client's bug; keep the stream alive.
      }
    }
  }
}

/** True when a command actually carries an instruction for the watch. */
function hasContent(command: ProbeCommand): boolean {
  return (
    command.breakpoints !== undefined ||
    (command.action !== undefined && command.action !== null) ||
    (command.evaluate !== undefined && command.evaluate !== null)
  );
}

export interface DebugServerOptions {
  /** HTTP port the watch polls. */
  port?: number;
  /** TCP port an editor attaches to for DAP. */
  dapPort?: number;
  /** Path to `<outfile>.dbg.json`, written by a `debug: true` build. */
  manifestPath: string;
  host?: string;
}

export interface DebugServer {
  close(): Promise<void>;
  /** The session the two transports share (exposed for tests). */
  session: DapSession;
  /** The ports actually bound — `0` in the options asks the OS to pick, which
   *  is how the suite runs without colliding with a live dev server. */
  bound: { port: number; dapPort: number };
}

/** Start the poll endpoint and the DAP listener. */
export async function startDebugServer(
  options: DebugServerOptions,
): Promise<DebugServer> {
  const host = options.host ?? "127.0.0.1";
  let client: Socket | undefined;

  // Re-read per call, not once at startup: a rebuild between two breakpoint
  // edits changes the file ids, and a session holding the old manifest would
  // set breakpoints in the wrong file with total confidence.
  const manifest = (): DebugManifest => {
    const empty: DebugManifest = { v: DEBUG_MANIFEST_VERSION, files: [] };
    try {
      const parsed = JSON.parse(
        readFileSync(options.manifestPath, "utf8"),
      ) as DebugManifest;
      // A dbg.json speaking a different shape version is worse than none:
      // its file ids and probe lines would be trusted and wrong. "No
      // breakpoints possible" is honest; misplaced breakpoints are not.
      return parsed.v === DEBUG_MANIFEST_VERSION ? parsed : empty;
    } catch {
      return empty;
    }
  };

  const session = new DapSession({
    manifest,
    send: (message) => {
      client?.write(encodeDapMessage(message));
    },
  });

  const dap = createTcpServer((socket) => {
    // One editor at a time: a second connection would silently share one
    // execution state and fight over the resume verb.
    if (client) {
      socket.destroy();
      return;
    }
    client = socket;
    const decoder = new DapDecoder();
    socket.on("data", (chunk: Buffer) => {
      decoder.push(chunk, (message) => {
        if (message.type === "request") session.handle(message);
      });
    });
    socket.on("close", () => {
      client = undefined;
    });
    socket.on("error", () => {
      client = undefined;
    });
  });

  const http = createHttpServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/debug/poll") {
      response.statusCode = 404;
      response.end("react-watchos debug: POST /debug/poll\n");
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      let state: ProbeState;
      try {
        state = JSON.parse(body) as ProbeState;
      } catch {
        response.statusCode = 400;
        response.end("{}");
        return;
      }
      void holdUntilWork(session, state).then((command) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(command));
      });
    });
  });

  await Promise.all([
    listen(http, options.port ?? 8790, host),
    listen(dap, options.dapPort ?? 8791, host),
  ]);
  const port = addressPort(http.address());
  const dapPort = addressPort(dap.address());
  console.log(
    `debug server: watch polls http://${host}:${port}/debug/poll\n` +
      `              editor attaches to DAP on tcp://${host}:${dapPort}\n` +
      `              breakpoints resolved through ${options.manifestPath}`,
  );

  return {
    session,
    bound: { port, dapPort },
    close: async () => {
      client?.destroy();
      await Promise.all([closeServer(http), closeServer(dap)]);
    },
  };
}

/** Poll the session until it has an instruction or the long poll times out. */
async function holdUntilWork(
  session: DapSession,
  state: ProbeState,
): Promise<ProbeCommand> {
  const deadline = Date.now() + LONG_POLL_MS;
  for (;;) {
    const command = session.poll(state);
    if (hasContent(command) || Date.now() >= deadline) return command;
    await new Promise((resolve) => setTimeout(resolve, LONG_POLL_TICK_MS));
  }
}

function listen(
  server: { listen: (port: number, host: string, cb: () => void) => void },
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve) => {
    server.listen(port, host, resolve);
  });
}

function closeServer(server: {
  close: (cb: () => void) => void;
}): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

function addressPort(address: unknown): number {
  return typeof address === "object" && address !== null && "port" in address
    ? Number((address as { port: number }).port)
    : 0;
}
