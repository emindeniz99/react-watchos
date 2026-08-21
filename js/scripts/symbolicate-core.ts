// The frame-resolution core behind `pnpm symbolicate`, extracted so the CLI
// and the tests that PROVE it share one implementation.
//
// Why it is its own module: two things about symbolication are easy to get
// wrong in a way no reader notices, and both belong in exactly one place.
//
//   1. The column bases differ. Every JS engine reports 1-based columns in a
//      stack frame; the source-map format is 0-based. Do the `- 1` at two call
//      sites and one of them will eventually lose it, and the result is not an
//      error — it is a position one character to the left, which usually still
//      resolves and quietly names the wrong token.
//   2. The frame shape. quickjs-ng writes `    at name (file:line:col)`, and
//      `name` is the MINIFIED one (`at n`), so the map's own name — when it has
//      one for that position — is the answer worth having.
//
// The pair below is also what makes js/test/qbc-symbolication.test.ts an
// honest gate: it resolves a real bytecode stack through THIS code, not
// through a second copy written for the test, so a bug here fails the suite
// instead of hiding behind it.

import {
  originalPositionFor,
  sourceContentFor,
  type TraceMap,
} from "@jridgewell/trace-mapping";

/**
 * One `at name (file:line:col)` line, split up. `at file:line:col` (no
 * parentheses, no function name) is deliberately NOT matched: quickjs-ng
 * always emits the parenthesized form, and a looser pattern would start
 * "resolving" ordinary prose lines that happen to contain a colon.
 */
export const STACK_FRAME_RE = /^(\s*at\s+)(.*?)\s*\((.*):(\d+):(\d+)\)\s*$/;

/** A parsed stack frame, with the engine's own (1-based) line and column. */
export interface StackFrame {
  /** Leading whitespace + `at `, kept so a re-print keeps the indentation. */
  prefix: string;
  /** The name the engine reported — minified, in a shipped bundle. */
  name: string;
  /** The file the engine reported (`bundle.js`, or an absolute path). */
  file: string;
  line: number;
  /** 1-based, as engines report it. {@link symbolicateFrame} converts. */
  column: number;
}

/** Parses one stack line, or `null` if it is not a frame. */
export function parseStackFrame(line: string): StackFrame | null {
  const match = STACK_FRAME_RE.exec(line);
  if (!match) return null;
  const [, prefix, name, file, lineNo, colNo] = match;
  return {
    prefix,
    name,
    file,
    line: Number(lineNo),
    column: Number(colNo),
  };
}

/** Where a frame really came from, in the ORIGINAL source. */
export interface OriginalPosition {
  /** Source path as the map records it (relative to the map's location). */
  source: string;
  line: number;
  /** 1-based, matching what an editor shows and what the engine reported. */
  column: number;
  /** The pre-minification identifier at that position, when the map has one. */
  name: string | null;
  /** The original file's text, when the map inlined it (`sourcesContent`). */
  sourceContent: string | null;
}

/**
 * Resolves one frame position through a source map.
 *
 * `line`/`column` are the engine's own numbers, straight off the frame — this
 * is the ONE place the 1-based → 0-based column conversion happens, and the
 * returned column is converted back, so no caller ever does ±1 arithmetic.
 *
 * Returns `null` when the map has no mapping for that position; callers should
 * print the frame through unchanged rather than drop it (a partly symbolicated
 * stack is still the stack).
 */
export function symbolicateFrame({
  tracer,
  line,
  column,
}: {
  tracer: TraceMap;
  line: number;
  /** 1-based, as the engine reported it. */
  column: number;
}): OriginalPosition | null {
  // A frame can carry a position that is not one: `at fn (<null>:0:1)` is what
  // quickjs-ng emits for a function with no debug info (bytecode compiled with
  // JS_WRITE_OBJ_STRIP_DEBUG, which tools/qjs-compile no longer does — but a
  // stack pasted in from an older build still can). `originalPositionFor`
  // THROWS on line 0, so without this guard one such frame takes down the
  // whole symbolication run; treating it as unresolvable prints it through
  // unchanged, which is the rule for every other frame we cannot place.
  if (!Number.isFinite(line) || line < 1 || !Number.isFinite(column)) {
    return null;
  }
  const position = originalPositionFor(tracer, {
    // Source maps are 0-based on columns; engines report 1-based. The clamp is
    // for the same class of nonsense position as the guard above — a 0 column
    // would otherwise become -1, which the mapper also rejects by throwing.
    column: Math.max(0, column - 1),
    line,
  });
  if (position.source == null || position.line == null) return null;
  return {
    source: position.source,
    line: position.line,
    column: (position.column ?? 0) + 1,
    name: position.name ?? null,
    sourceContent: sourceContentFor(tracer, position.source),
  };
}
