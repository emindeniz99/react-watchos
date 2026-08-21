/**
 * The dev-server half of the DEBUG-only source-level debugger: a minimal Debug
 * Adapter Protocol adapter that speaks DAP to an editor on one side and the
 * watch's poll channel on the other (docs/design-dap-debugger.md).
 *
 * DAP, not the Chrome DevTools Protocol: CDP is what Hermes/React Native use,
 * but it is an ENGINE protocol — Hermes implements `Debugger.*` inside the VM.
 * We have no engine support to expose, so the protocol we implement is the one
 * spoken by the CLIENT (VS Code) rather than by an engine we do not have. DAP
 * is also the protocol koush/vscode-quickjs-debug forwards, so an editor
 * configured for a QuickJS debugger needs no new concepts here.
 *
 * TRANSPORT-AGNOSTIC ON PURPOSE. This module imports nothing from `node:`, so
 * the same session object runs (a) in the dev server behind a TCP socket and an
 * HTTP endpoint, and (b) inside the vendored quickjs-ng in the integration
 * test, where it is bundled next to the instrumented fixture and driven through
 * a synchronous `__debugPoll`. The test therefore exercises this adapter, not a
 * mock of it.
 *
 * `poll()` is deliberately SYNCHRONOUS and non-blocking: the watch's side of
 * the channel is a blocking host call, so all the waiting belongs in the
 * server's long-poll loop (debug-server.mts), never in the protocol logic.
 */
import type { DebugManifest } from "../esbuild/debug-probe.mts";
import type {
  DebugFrame,
  ProbeCommand,
  ProbeState,
  StepAction,
} from "../src/debugWire.ts";
import { DEBUG_WIRE_VERSION } from "../src/debugWire.ts";

/** A DAP message: request, response or event (base protocol, `seq`-numbered). */
export interface DapMessage {
  seq: number;
  type: "request" | "response" | "event";
  command?: string;
  event?: string;
  arguments?: Record<string, unknown>;
  body?: Record<string, unknown>;
  request_seq?: number;
  success?: boolean;
  message?: string;
}

/** The one thread a watch runtime has. QuickJS is single-context here, and DAP
 *  requires at least one thread id for `stopped`/`stackTrace` to refer to. */
const THREAD_ID = 1;

/** Scope/variable handles are `frameIndex + 1` so 0 stays DAP's "no children". */
const VARIABLES_BASE = 1;

export interface DapSessionOptions {
  /** Send one DAP message to the client. */
  send: (message: DapMessage) => void;
  /** The build's file/probe manifest. Re-read on each `setBreakpoints` by the
   *  server so a rebuild between two breakpoint edits is picked up. */
  manifest: () => DebugManifest;
}

/**
 * A minimal DAP adapter over the watch poll channel.
 *
 * Implemented verbs: `initialize`, `launch`, `attach`, `configurationDone`,
 * `setBreakpoints`, `setExceptionBreakpoints`, `threads`, `stackTrace`,
 * `scopes`, `variables`, `continue`, `next`, `stepIn`, `stepOut`, `pause`,
 * `evaluate`, `disconnect`. Everything else gets an explicit "unsupported"
 * error response rather than silence — an editor that asked for something we
 * do not have should be told, not left waiting.
 */
export class DapSession {
  private readonly send: (message: DapMessage) => void;
  private readonly readManifest: () => DebugManifest;
  private seq = 1;

  /** fileId → breakpoint lines, already snapped to instrumented lines. */
  private breakpoints: Record<string, number[]> = {};
  /** True until the watch has been told about the current breakpoint set. */
  private breakpointsDirty = true;

  /** The frames reported by the most recent pause, top first. */
  private frames: DebugFrame[] = [];
  private paused = false;
  /** The resume verb queued for the next exchange with the watch. */
  private pendingAction: StepAction | null = null;

  /** In-flight `evaluate`: DAP needs a response, but only the watch can
   *  produce one, so the request is parked until an exchange brings it back. */
  private pendingEvaluate:
    | { seq: number; requestSeq: number; expression: string }
    | undefined;
  private evaluateSeq = 0;

  constructor(options: DapSessionOptions) {
    this.send = options.send;
    this.readManifest = options.manifest;
  }

  /** True while the watch is parked at a breakpoint or step. */
  get isPaused(): boolean {
    return this.paused;
  }

  /** True when the next exchange has something to tell the watch — the
   *  server's long poll returns early on this instead of sleeping out. */
  get hasWork(): boolean {
    return (
      this.breakpointsDirty ||
      this.pendingAction !== null ||
      this.pendingEvaluate !== undefined
    );
  }

  // ---------------------------------------------------------------- watch side

  /**
   * One exchange with the watch. Called from the poll endpoint (or, in the
   * integration test, straight from the instrumented bundle's `__debugPoll`).
   */
  poll(state: ProbeState): ProbeCommand {
    if (state.evaluated && this.pendingEvaluate) {
      const parked = this.pendingEvaluate;
      if (state.evaluated.seq === parked.seq) {
        this.pendingEvaluate = undefined;
        this.respond(parked.requestSeq, "evaluate", {
          result: state.evaluated.error ?? state.evaluated.result,
          variablesReference: 0,
        });
      }
    }

    if (state.state === "paused") {
      const first = !this.paused;
      this.paused = true;
      this.frames = state.frames ?? [];
      if (first) {
        this.event("stopped", {
          reason: state.reason ?? "breakpoint",
          threadId: THREAD_ID,
          allThreadsStopped: true,
        });
      }
    } else if (this.paused) {
      this.paused = false;
      this.frames = [];
    }

    const command: ProbeCommand = { v: DEBUG_WIRE_VERSION };
    if (this.breakpointsDirty) {
      command.breakpoints = this.breakpoints;
      this.breakpointsDirty = false;
    }
    // An evaluate must be answered BEFORE the resume verb, or the watch would
    // run on and the frame the expression referred to would be gone.
    if (this.pendingEvaluate) {
      command.evaluate = {
        seq: this.pendingEvaluate.seq,
        expression: this.pendingEvaluate.expression,
      };
      return command;
    }
    if (this.pendingAction !== null) {
      command.action = this.pendingAction;
      this.pendingAction = null;
      if (command.action !== "pause") this.paused = false;
    }
    return command;
  }

  // ----------------------------------------------------------------- DAP side

  /** Handle one DAP request from the client. */
  handle(request: DapMessage): void {
    const args = request.arguments ?? {};
    switch (request.command) {
      case "initialize":
        this.respond(request.seq, "initialize", {
          supportsConfigurationDoneRequest: true,
          supportsEvaluateForHovers: true,
          // Everything below is deliberately absent rather than false-claimed:
          // conditional breakpoints, function breakpoints, `setVariable`,
          // restart and stepping backwards are not implemented (design doc,
          // "What this prototype does NOT do").
        });
        this.event("initialized", {});
        return;
      case "launch":
      case "attach":
        // There is nothing to launch: the watch app runs itself and connects
        // when its probes first poll. Both verbs are accepted so an editor
        // configured either way works.
        this.respond(request.seq, request.command, {});
        return;
      case "configurationDone":
        this.respond(request.seq, "configurationDone", {});
        return;
      case "setBreakpoints":
        this.setBreakpoints(request, args);
        return;
      case "setExceptionBreakpoints":
        // Accepted and ignored: nothing here can stop on a throw (the probe
        // sits at statement boundaries, not on the engine's exception path).
        this.respond(request.seq, "setExceptionBreakpoints", {});
        return;
      case "threads":
        this.respond(request.seq, "threads", {
          threads: [{ id: THREAD_ID, name: "watch js" }],
        });
        return;
      case "stackTrace":
        this.respond(request.seq, "stackTrace", {
          stackFrames: this.stackFrames(),
          totalFrames: this.frames.length,
        });
        return;
      case "scopes":
        this.scopes(request, args);
        return;
      case "variables":
        this.variables(request, args);
        return;
      case "continue":
        this.resume(request, "continue", { allThreadsContinued: true });
        return;
      case "next":
      case "stepIn":
      case "stepOut":
        this.resume(request, request.command, {});
        return;
      case "pause":
        this.pendingAction = "pause";
        this.respond(request.seq, "pause", {});
        return;
      case "evaluate":
        this.evaluate(request, args);
        return;
      case "disconnect":
      case "terminate":
        // Leave the app RUNNING and un-breakpointed: detaching a debugger from
        // a watch must not strand the app parked on a line nobody is watching.
        this.breakpoints = {};
        this.breakpointsDirty = true;
        this.pendingAction = "continue";
        this.respond(request.seq, request.command, {});
        return;
      default:
        this.fail(
          request.seq,
          request.command ?? "(none)",
          `unsupported request: ${request.command}`,
        );
    }
  }

  // ------------------------------------------------------------------ helpers

  private setBreakpoints(
    request: DapMessage,
    args: Record<string, unknown>,
  ): void {
    const source = (args.source ?? {}) as { path?: string };
    const requested = (args.breakpoints ?? []) as Array<{ line: number }>;
    const manifest = this.readManifest();
    const index = manifest.files.findIndex((f) =>
      samePath(f.path, source.path),
    );
    const file = index >= 0 ? manifest.files[index] : undefined;

    const verified: Array<{
      verified: boolean;
      line?: number;
      message?: string;
    }> = [];
    const lines: number[] = [];
    for (const bp of requested) {
      if (!file) {
        verified.push({
          verified: false,
          message: `not in this build: ${source.path ?? "(no path)"}`,
        });
        continue;
      }
      // DAP expects the ACTUAL breakpoint back so the editor can redraw it: a
      // line with no probe (a blank line, a declaration, a closing brace) is
      // moved down to the next instrumented line rather than silently dropped.
      const actual = file.lines.find((line) => line >= bp.line);
      if (actual === undefined) {
        verified.push({ verified: false, message: "no statement at or below" });
        continue;
      }
      lines.push(actual);
      verified.push({ verified: true, line: actual });
    }

    const next: Record<string, number[]> = { ...this.breakpoints };
    if (index >= 0) {
      if (lines.length > 0) next[String(index)] = lines;
      else delete next[String(index)];
    }
    this.breakpoints = next;
    this.breakpointsDirty = true;
    this.respond(request.seq, "setBreakpoints", { breakpoints: verified });
  }

  private stackFrames(): Array<Record<string, unknown>> {
    const manifest = this.readManifest();
    return this.frames.map((frame, i) => {
      const file = manifest.files[frame.file];
      return {
        id: i,
        name: frame.name,
        line: frame.line,
        // Column 1: the probe knows the statement, not the character. Reporting
        // a made-up column would move the editor's caret to a lie.
        column: 1,
        ...(file
          ? { source: { name: baseName(file.path), path: file.path } }
          : {}),
      };
    });
  }

  private scopes(request: DapMessage, args: Record<string, unknown>): void {
    const frameId = Number(args.frameId ?? 0);
    const frame = this.frames[frameId];
    const hasArgs = frame?.args !== undefined;
    this.respond(request.seq, "scopes", {
      scopes: [
        {
          // "Arguments", not "Locals": what is in here is exactly the captured
          // parameter list, and calling it Locals would promise a scope walk
          // this design does not do.
          name: "Arguments",
          variablesReference: hasArgs ? VARIABLES_BASE + frameId : 0,
          expensive: false,
        },
      ],
    });
  }

  private variables(request: DapMessage, args: Record<string, unknown>): void {
    const reference = Number(args.variablesReference ?? 0);
    const frame = this.frames[reference - VARIABLES_BASE];
    const captured = frame?.args ?? {};
    this.respond(request.seq, "variables", {
      variables: Object.keys(captured).map((name) => ({
        name,
        value: captured[name] ?? "",
        variablesReference: 0,
      })),
    });
  }

  private resume(
    request: DapMessage,
    action: StepAction,
    body: Record<string, unknown>,
  ): void {
    this.pendingAction = action;
    this.respond(request.seq, request.command ?? action, body);
    this.event("continued", {
      threadId: THREAD_ID,
      allThreadsContinued: true,
    });
  }

  private evaluate(request: DapMessage, args: Record<string, unknown>): void {
    const expression = String(args.expression ?? "");
    if (!this.paused) {
      this.fail(request.seq, "evaluate", "not paused");
      return;
    }
    this.evaluateSeq += 1;
    this.pendingEvaluate = {
      seq: this.evaluateSeq,
      requestSeq: request.seq,
      expression,
    };
    // No response yet — it is sent from `poll()` when the watch answers.
  }

  private respond(
    requestSeq: number,
    command: string,
    body: Record<string, unknown>,
  ): void {
    this.send({
      seq: this.seq++,
      type: "response",
      request_seq: requestSeq,
      success: true,
      command,
      body,
    });
  }

  private fail(requestSeq: number, command: string, message: string): void {
    this.send({
      seq: this.seq++,
      type: "response",
      request_seq: requestSeq,
      success: false,
      command,
      message,
    });
  }

  private event(event: string, body: Record<string, unknown>): void {
    this.send({ seq: this.seq++, type: "event", event, body });
  }
}

/** Compare two filesystem paths for the purpose of matching a DAP `source`.
 *  Case-sensitive, separator-normalized: an editor on Windows sends `\`. */
function samePath(a: string, b: string | undefined): boolean {
  if (b === undefined) return false;
  return a.replace(/\\/g, "/") === b.replace(/\\/g, "/");
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}
