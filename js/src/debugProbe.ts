/**
 * The watch half of the DEBUG-only source-level debugger (docs/design-dap-debugger.md).
 *
 * quickjs-ng has NO debug API — not in v0.16.1, not upstream (quickjs-ng#757).
 * The only implementation that exists (koush/quickjs) is an engine FORK with a
 * second opcode dispatch table, and this repo refreshes
 * js/swift/Sources/CQuickJS file-by-file from upstream on a bot's schedule, so a
 * patched engine would turn every bump into a merge. So the breakpoint does not
 * live in the engine: a DEBUG-only build transform (esbuild/debug-probe.mts)
 * rewrites every statement to call `__dbg(file, line)` first, and this module is
 * what those calls land in.
 *
 * Injected (not imported): the transform's probes are bare global calls, so the
 * runtime has to exist before the first instrumented statement runs. The preset
 * prepends this module to esbuild's `inject` list in a debug build and does not
 * mention it otherwise, which is also what keeps it out of a shipping bundle —
 * an `import` would keep the module alive however dead the call site is (the
 * lesson src/inspector.ts cost 1,307 B to learn).
 *
 * The transport is one synchronous host call, `globalThis.__debugPoll(json) ->
 * json`, because a paused debugger has to BLOCK and `fetch` cannot settle while
 * it does: the app runtime's owning queue is `DispatchQueue.main`
 * (JSRuntime.swift), so a JS loop that spins waiting for `__resolveFetch` is
 * waiting on the very thread that would have to deliver it. Deadlock, not
 * slowness. `__debugPoll` is installed by the Swift host under `#if DEBUG`
 * exactly like `__inspectorUrl` already is, and deliberately NOT through the
 * generated `__host` bridge — that table is compiled into release builds and
 * published as an ARCH-01 capability, which a debugger must never be.
 *
 * No `__debugPoll` (any release build, any test that doesn't install one) means
 * DETACHED: the probes still book-keep the current line, but nothing can ever
 * pause, so the loop below can never spin forever in a build nobody is
 * debugging.
 */

import {
  DEBUG_WIRE_VERSION,
  type DebugFrame,
  type FunctionEntry,
  type ProbeCommand,
  type ProbeState,
  type StepAction,
  type StopReason,
} from "./debugWire";

interface Frame {
  file: number;
  line: number;
  /** Index into {@link functions}, or -1 for the synthetic module frame. */
  fn: number;
  args: unknown[] | undefined;
}

type ProbeGlobal = {
  __debugPoll?: (json: string) => string;
  __dbg?: (file: number, line: number) => void;
  __dbg_p?: (fn: number, args?: unknown[]) => void;
  __dbg_o?: () => void;
  __dbg_r?: (startId: number, entries: FunctionEntry[]) => void;
};

const g = globalThis as ProbeGlobal;

/** fnId → `[name, file, line, params]`, filled by each file's registration. */
const functions: FunctionEntry[] = [];

const baseFrame: Frame = { file: -1, line: 0, fn: -1, args: undefined };
/** The frame every probe writes into — kept in a variable rather than read as
 *  `stack[stack.length - 1]` because this is THE hot path: two property stores
 *  and a compare per statement is the whole steady-state budget. */
let top: Frame = baseFrame;
const stack: Frame[] = [];

/** fileId → line → 1. Plain objects: a numeric-keyed lookup miss is the common
 *  case and it is the cheapest miss the engine has. */
let breakpoints: Record<number, Record<number, 1>> = {};
/** Whether ANY breakpoint exists — one boolean test skips the lookup entirely
 *  in the (overwhelmingly common) no-breakpoints-set state. */
let armed = false;

let stepMode: StepAction | null = null;
let stepDepth = 0;

/** Statements left before the next running check-in. */
let ticks = 1;
/** How many statements may run between two `Date.now()` reads while free. */
const IDLE_TICKS = 2000;
/** …and how much wall-clock between two running exchanges. The watch is
 *  otherwise silent: a debugger that polled per statement would be slower than
 *  the bug. */
const RUNNING_POLL_MS = 500;
let lastPollAt = 0;

/** Set once the host proves it has no `__debugPoll`: nothing can ever pause,
 *  so stop asking. This is what makes an instrumented bundle safe to run with
 *  no dev server attached. */
let detached = false;

/** A paused watch gives up after this many fruitless exchanges (~10 min at the
 *  server's 1 s long-poll) and resumes, so a dev server that dies mid-pause
 *  leaves a running app rather than a wedged one. */
const MAX_PAUSED_EXCHANGES = 600;

/** String(x) that never throws (null-prototype / throwing toString). */
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unserializable]";
  }
}

/** A short, safe, human-readable rendering for the variables pane. */
function preview(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "function") {
    const name = (value as { name?: string }).name;
    return `function ${name ? name : "(anonymous)"}`;
  }
  if (t === "object") {
    try {
      const json = JSON.stringify(value);
      if (json === undefined) return safeString(value);
      return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    } catch {
      return "[circular or unserializable]";
    }
  }
  return safeString(value);
}

/** Freeze the shadow stack into the wire shape, top frame first. */
function snapshot(): DebugFrame[] {
  const out: DebugFrame[] = [];
  for (let i = stack.length; i >= 0; i--) {
    const frame = i === stack.length ? top : stack[i];
    if (frame === undefined) continue;
    const entry = frame.fn >= 0 ? functions[frame.fn] : undefined;
    const wire: DebugFrame = {
      file: frame.file,
      line: frame.line,
      name: entry ? entry[0] : "(module)",
    };
    const names = entry ? entry[3] : undefined;
    if (names !== undefined && names.length > 0 && frame.args !== undefined) {
      const args: Record<string, string> = {};
      for (let p = 0; p < names.length; p++) {
        const name = names[p];
        if (name !== undefined) args[name] = preview(frame.args[p]);
      }
      wire.args = args;
    }
    out.push(wire);
  }
  return out;
}

/** Replace the whole breakpoint set (DAP semantics — see {@link ProbeCommand}). */
function setBreakpoints(next: Record<string, number[]>): void {
  const table: Record<number, Record<number, 1>> = {};
  let any = false;
  for (const key of Object.keys(next)) {
    const lines = next[key];
    if (lines === undefined) continue;
    const perFile: Record<number, 1> = {};
    for (const line of lines) {
      perFile[line] = 1;
      any = true;
    }
    table[Number(key)] = perFile;
  }
  breakpoints = table;
  armed = any;
}

/** One synchronous round trip to the dev server. `undefined` = no host (or a
 *  malformed answer), which detaches the probe for the rest of the run. */
function exchange(state: ProbeState): ProbeCommand | undefined {
  const poll = g.__debugPoll;
  if (typeof poll !== "function") {
    detached = true;
    return undefined;
  }
  try {
    const raw = poll(JSON.stringify(state));
    // The server ALWAYS answers with a JSON object, even when its long poll
    // times out with nothing to say (`{"v":1}`). So an empty or non-string
    // answer is not "nothing to report", it is the transport failing — the
    // host hook is installed but no dev server is behind it. Detach instead of
    // spinning: one dead exchange per runtime boot, then never again.
    if (typeof raw !== "string" || raw === "") {
      detached = true;
      return undefined;
    }
    const parsed = JSON.parse(raw) as ProbeCommand;
    return parsed && typeof parsed === "object"
      ? parsed
      : { v: DEBUG_WIRE_VERSION };
  } catch {
    // A dev server that went away must not take the app with it.
    detached = true;
    return undefined;
  }
}

/**
 * Evaluate an expression against the paused top frame.
 *
 * Deliberately NOT a scope walker (the design doc says so out loud): the only
 * names in scope here are the ones the transform captured — plain-identifier
 * parameters of the frame — plus whatever a global-scope `eval` can see. A
 * closure variable or a `const` declared inside the function body is NOT
 * reachable, and reports that rather than a confident wrong answer.
 */
function evaluateInFrame(expression: string): {
  result: string;
  error?: string;
} {
  const entry = top.fn >= 0 ? functions[top.fn] : undefined;
  const names = entry ? entry[3] : undefined;
  if (names !== undefined && top.args !== undefined) {
    const index = names.indexOf(expression.trim());
    if (index >= 0) return { result: preview(top.args[index]) };
  }
  const globalEval = (globalThis as { eval?: (source: string) => unknown })
    .eval;
  if (typeof globalEval !== "function") {
    return { result: "", error: `not a captured argument: ${expression}` };
  }
  try {
    // INDIRECT eval — the callee is a local binding, not the identifier
    // `eval`, so this evaluates in GLOBAL scope by specification. Local and
    // closure variables are invisible here; that is the honest limit, not a
    // bug, and it is why captured arguments are checked first.
    return { result: preview(globalEval(expression)) };
  } catch (error) {
    return { result: "", error: safeString(error) };
  }
}

/** Park the JS thread until the dev server says to move. */
function pauseHere(reason: StopReason): void {
  stepMode = null;
  const state: ProbeState = {
    v: DEBUG_WIRE_VERSION,
    state: "paused",
    reason,
    frames: snapshot(),
  };
  for (let i = 0; i < MAX_PAUSED_EXCHANGES; i++) {
    const command = exchange(state);
    if (command === undefined) break;
    if (command.breakpoints !== undefined) setBreakpoints(command.breakpoints);
    if (command.evaluate) {
      const answer = evaluateInFrame(command.evaluate.expression);
      state.evaluated = {
        seq: command.evaluate.seq,
        result: answer.result,
        ...(answer.error === undefined ? {} : { error: answer.error }),
      };
      continue;
    }
    delete state.evaluated;
    const action = command.action;
    if (action === undefined || action === null || action === "pause") continue;
    if (action !== "continue") {
      stepMode = action;
      stepDepth = stack.length;
      // stepOut from the outermost frame has nothing to step out OF; running
      // free is what the user meant, not "never stop again".
      if (action === "stepOut" && stepDepth === 0) stepMode = null;
    }
    break;
  }
  lastPollAt = Date.now();
  // The check-in budget, and ONLY that: breakpoints and stepping are tested on
  // every probe regardless of `ticks`, so there is nothing to gain by asking
  // the server more often just because a breakpoint exists.
  ticks = IDLE_TICKS;
}

/** The periodic running exchange: picks up a newly set breakpoint and an
 *  async `pause` request without the app being stopped. Returns whether it
 *  ended up pausing, so the caller does not immediately stop a second time on
 *  the same statement. */
function checkIn(): boolean {
  const command = exchange({ v: DEBUG_WIRE_VERSION, state: "running" });
  if (command === undefined) return false;
  if (command.breakpoints !== undefined) setBreakpoints(command.breakpoints);
  if (command.action !== "pause") return false;
  pauseHere("pause");
  return true;
}

/**
 * The statement probe. Everything about this function is a budget decision:
 * two stores, one null compare, one boolean test and one decrement is what
 * every statement in the instrumented bundle pays.
 */
function probe(file: number, line: number): void {
  top.file = file;
  top.line = line;
  if (stepMode !== null) {
    const depth = stack.length;
    if (
      stepMode === "stepIn" ||
      (stepMode === "next" && depth <= stepDepth) ||
      (stepMode === "stepOut" && depth < stepDepth)
    ) {
      pauseHere("step");
      return;
    }
  }
  if (armed) {
    const lines = breakpoints[file];
    if (lines !== undefined && lines[line] === 1) {
      pauseHere("breakpoint");
      return;
    }
  }
  if (detached) return;
  if (--ticks > 0) return;
  ticks = IDLE_TICKS;
  const now = Date.now();
  if (now - lastPollAt < RUNNING_POLL_MS) return;
  lastPollAt = now;
  if (checkIn()) return;
  // Re-check THIS statement: the exchange above is where a breakpoint set by
  // the editor first reaches the watch, and the very first probed line would
  // otherwise be the one line a breakpoint could never hold. Skipped when the
  // check-in already paused, so an editor that asked for `pause` on a line that
  // also carries a breakpoint stops once, not twice.
  if (armed) {
    const lines = breakpoints[file];
    if (lines !== undefined && lines[line] === 1) pauseHere("breakpoint");
  }
}

/** Push a frame. `args` is the transform's compile-time-known parameter list,
 *  passed only for functions that have capturable (plain identifier) ones. */
function pushFrame(fn: number, args?: unknown[]): void {
  stack.push(top);
  const entry = functions[fn];
  top = {
    file: entry ? entry[1] : -1,
    line: entry ? entry[2] : 0,
    fn,
    args,
  };
}

/** Pop a frame. Called from the transform's `finally`, so it runs on a throw
 *  too — otherwise one exception would desynchronize the stack forever. */
function popFrame(): void {
  top = stack.pop() ?? baseFrame;
}

/** Register one file's functions at consecutive ids assigned at build time. */
function registerFunctions(startId: number, entries: FunctionEntry[]): void {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry !== undefined) functions[startId + i] = entry;
  }
}

g.__dbg = probe;
g.__dbg_p = pushFrame;
g.__dbg_o = popFrame;
g.__dbg_r = registerFunctions;
