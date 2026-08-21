/**
 * The protocol between the instrumented watch bundle and the dev server's DAP
 * adapter (docs/design-dap-debugger.md). Types and one constant — NO runtime
 * state, deliberately: `src/debugProbe.ts` installs globals on import, and the
 * adapter (`bin/dap-session.mts`) must be able to share the contract without
 * dragging a second copy of the probe runtime in with it.
 *
 * One exchange = one blocking `globalThis.__debugPoll(json) -> json` call from
 * the watch. There is no server-initiated message: the watch is the client on
 * this channel, because the only transport a paused QuickJS thread has is a
 * synchronous host call it makes itself.
 */

/** Bumped when {@link ProbeState}/{@link ProbeCommand} change shape. */
export const DEBUG_WIRE_VERSION = 1;

/** One frame of the shadow call stack, in ORIGINAL source coordinates.
 *  Instrumentation's payoff: no source map is needed to read this, because the
 *  probe was placed by something that could still see the original file. */
export interface DebugFrame {
  /** Index into the build's file table (`<outfile>.dbg.json` → `files`). */
  file: number;
  /** 1-based line in that original file. */
  line: number;
  /** Function name as written, or `"(module)"` for top-level statements. */
  name: string;
  /** Plain-identifier parameters captured at entry, name → preview string.
   *  Absent when the function has none (see the scope limits in the design). */
  args?: Record<string, string>;
}

/** Why the watch stopped. Mapped 1:1 onto DAP's `stopped.reason`. */
export type StopReason = "breakpoint" | "step" | "pause" | "entry";

/** What the watch tells the dev server on every exchange. */
export interface ProbeState {
  v: number;
  state: "running" | "paused";
  reason?: StopReason;
  /** Top frame first. Present only when paused. */
  frames?: DebugFrame[];
  /** The answer to a previous command's `evaluate`. */
  evaluated?: { seq: number; result: string; error?: string };
}

/** DAP's stepping verbs, as they cross the poll channel. */
export type StepAction = "continue" | "next" | "stepIn" | "stepOut" | "pause";

/** What the dev server tells the watch in reply. */
export interface ProbeCommand {
  v: number;
  /** The COMPLETE breakpoint set, fileId → lines. Non-incremental, matching
   *  DAP's `setBreakpoints` ("clear all previous breakpoints for the source and
   *  then set the ones specified"), so a dropped exchange cannot leave the
   *  watch holding a stale breakpoint the UI no longer shows. */
  breakpoints?: Record<string, number[]>;
  /** Resume verb. Absent/null while paused = "keep waiting". */
  action?: StepAction | null;
  /** Evaluate this in the paused frame and report it on the next exchange. */
  evaluate?: { seq: number; expression: string; frameId?: number } | null;
}

/** `[name, fileId, declarationLine, parameterNames]` — one instrumented
 *  function, registered per file by the build transform. */
export type FunctionEntry = [string, number, number, string[]];
