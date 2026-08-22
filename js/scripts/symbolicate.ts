// Turns a stack trace from a SHIPPED (minified) bundle back into source
// positions, using the map the build already writes next to it.
//
// Why this is possible at all: the engine the watch runs — the vendored
// quickjs-ng, not the `apt-get install quickjs` one — reports `file:line:col`
// for every frame, including inside a bundle minified onto one line:
//
//     at n (bundle.js:1:30)
//
// A column is exactly what a source map needs, so each frame resolves to the
// original file, line, column and (when the map records one) the original name.
// That is the same mechanism a hosted error tracker uses; this script is the
// local, dependency-light version of it.
//
// It works on stacks from the PRODUCTION path too, not just the dev one: the
// shipped `.qbc` bytecode keeps its line/column tables (tools/qjs-compile
// passes STRIP_SOURCE but deliberately NOT STRIP_DEBUG), so a frame out of
// bytecode is identical to a frame out of the parsed source and resolves the
// same way. js/test/qbc-symbolication.test.ts proves that end to end through
// this file's own core.
//
//   pnpm --filter react-watchos symbolicate dist/bundle.js.map < stack.txt
//   pbpaste | pnpm --filter react-watchos symbolicate dist/bundle.js.map
//
// The other two modes exist because a stack from the FIELD does not arrive with
// a map path — it arrives with a `releaseId`, and by then the map beside the
// outfile has been overwritten by the next build. Given a store a build kept
// (`--symbols`, see esbuild/symbol-store.mts), that id IS the lookup:
//
//   pnpm symbolicate --symbols ./symbols --release 8c4f… < stack.txt
//   pnpm symbolicate --symbols ./symbols --diagnostics ring.json
//
// The second reads a diagnostics-ring document (what the inspector serves and
// what `src/diagnostics.ts` types) and resolves EACH record against its OWN
// releaseId — a ring routinely spans a rollback, so one map for the whole
// document would be wrong for part of it.
//
// Frames it cannot resolve are printed through UNCHANGED rather than dropped:
// a partly-symbolicated stack is still the stack, and silently eating a frame
// is how you lose the one that mattered.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { TraceMap } from "@jridgewell/trace-mapping";
import {
  describeSymbolStore,
  readSymbolEntry,
} from "../esbuild/symbol-store.mts";
import { parseStackFrame, symbolicateFrame } from "./symbolicate-core.ts";

const USAGE =
  "usage: symbolicate <bundle.js.map>   (the stack arrives on stdin)\n" +
  "       symbolicate --symbols <dir> --release <id> [--target <name>]\n" +
  "       symbolicate --symbols <dir> --diagnostics [ring.json]\n" +
  "The map is written beside the bundle on every build — sourcemap is on " +
  "by default and costs the shipped bytes nothing (it is `external`, so no " +
  "sourceMappingURL comment is added).\n" +
  "--symbols reads the store a build kept with `react-watchos build " +
  "--symbols <dir>` (or `buildBundles({ symbols })`), keyed by the same " +
  "releaseId a field stack arrives with. --diagnostics reads a diagnostics " +
  "ring (stdin, or the named file) and resolves every record against its own " +
  "releaseId.";

function usage(): never {
  console.error(USAGE);
  process.exit(2);
}

function fail(error: unknown): never {
  console.error(
    `[symbolicate] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

/**
 * Print one stack, frame by frame. The ONLY printer — the map-path mode, the
 * `--release` mode and every record of a `--diagnostics` run share it, so the
 * three cannot drift into three slightly different renderings of the same
 * frame.
 */
function printStack(tracer: TraceMap, stack: string): void {
  for (const line of stack.split("\n")) {
    const frame = parseStackFrame(line);
    if (!frame) {
      console.log(line);
      continue;
    }
    // The frame's own name is the MINIFIED one (`at n`), so the map's name for
    // that position wins whenever it has one.
    const position = symbolicateFrame({
      tracer,
      line: frame.line,
      column: frame.column,
    });
    if (!position) {
      console.log(`${line}   [no mapping]`);
      continue;
    }
    console.log(
      `${frame.prefix}${position.name ?? frame.name} ` +
        `(${position.source}:${position.line}:${position.column})` +
        `   [was ${frame.name} @ ${frame.file.split("/").pop()}:${frame.line}:${frame.column}]`,
    );
  }
}

function tracerFor(mapPath: string): TraceMap {
  return new TraceMap(
    JSON.parse(readFileSync(mapPath, "utf8")) as ConstructorParameters<
      typeof TraceMap
    >[0],
  );
}

/** The subset of a `Diagnostic` (src/diagnostics.ts) this reads. */
interface DiagnosticRecord {
  code?: string;
  severity?: string;
  subsystem?: string;
  /** "watch" | "widget" — the embedding, used as a soft target hint. */
  target?: string;
  releaseId?: string;
  timestamp?: number;
  /**
   * The human-readable message. For a `js.*` record this is the runtime's
   * "message\nstack" text (JSRuntime.swift appends `Error.stack` for a real
   * Error), which is why the frames are in HERE and not in a field of their
   * own — there is no separate `stack` on a Diagnostic.
   */
  details?: string;
}

/**
 * Pull the ring out of whatever was piped in: the inspector's snapshot
 * (`{ commits, tree, logs, errors, diagnostics }` — `inspectorSnapshot()`),
 * a bare `{ diagnostics: [...] }`, or the array on its own.
 */
function diagnosticsOf(document: unknown): DiagnosticRecord[] {
  if (Array.isArray(document)) return document as DiagnosticRecord[];
  const nested = (document as { diagnostics?: unknown } | null)?.diagnostics;
  if (Array.isArray(nested)) return nested as DiagnosticRecord[];
  throw new Error(
    "not a diagnostics document — expected the inspector's snapshot " +
      "({ diagnostics: [...] }, what `inspectorSnapshot()` posts) or a bare " +
      "array of Diagnostic records",
  );
}

/** One record's header, in the shape Swift's LogDiagnosticsSink prints. */
function headerOf(record: DiagnosticRecord): string {
  const when = Number.isFinite(record.timestamp)
    ? new Date(record.timestamp as number).toISOString()
    : "no timestamp";
  return (
    `[${record.severity ?? "?"}] ${record.code ?? "?"} ` +
    `(${record.subsystem ?? "?"}/${record.target ?? "?"}) ` +
    `release ${record.releaseId ?? "none"} ${when}`
  );
}

const { values, positionals } = (() => {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        symbols: { type: "string" },
        release: { type: "string" },
        target: { type: "string" },
        diagnostics: { type: "boolean" },
      },
    });
  } catch (error) {
    console.error(
      `[symbolicate] ${error instanceof Error ? error.message : String(error)}`,
    );
    return usage();
  }
})();

if (values.diagnostics) {
  // ---- diagnostics ring: every record against its OWN releaseId ----------
  const symbolsDir = values.symbols;
  if (!symbolsDir) {
    console.error("[symbolicate] --diagnostics needs --symbols <dir>");
    usage();
  }
  const source = positionals[0];
  const records = (() => {
    try {
      return diagnosticsOf(
        JSON.parse(readFileSync(source ?? 0, "utf8")) as unknown,
      );
    } catch (error) {
      // A malformed paste is the common case here (half a ring, a log line
      // copied in with it), so it gets the one-line report every other failure
      // gets rather than a Node stack trace about JSON.
      return fail(error);
    }
  })();
  if (records.length === 0) console.log("(no diagnostics in this document)");

  // One lookup per (release, target hint), not per record: a 50-entry ring is
  // mostly one release, and re-reading + re-parsing its map 50 times is the
  // difference between instant and not on a 1 MB map.
  const cache = new Map<string, TraceMap | string>();
  let stacksSeen = 0;
  let stacksResolved = 0;
  let missing = false;

  for (const record of records) {
    console.log(headerOf(record));
    const details = record.details ?? "";
    const hasFrames = details.split("\n").some((l) => parseStackFrame(l));
    if (!hasFrames) {
      if (details) console.log(details);
      console.log("");
      continue;
    }
    stacksSeen += 1;
    if (!record.releaseId) {
      // Nil before a bundle loaded, and for a DEBUG dev-code boot (see
      // Diagnostic.releaseId). There is nothing to look the map up BY, so the
      // frames go through raw rather than be resolved against a guess.
      console.log("  [no releaseId on this record — frames left unresolved]");
      console.log(details);
      console.log("");
      continue;
    }
    const key = `${record.releaseId} ${values.target ?? record.target ?? ""}`;
    let found = cache.get(key);
    if (found === undefined) {
      try {
        const entry = readSymbolEntry({
          symbolsDir,
          releaseId: record.releaseId,
          target: values.target,
          preferTarget: record.target,
        });
        found = entry.mapPath
          ? tracerFor(entry.mapPath)
          : `entry ${record.releaseId}/${entry.target} has no map ` +
            "(built with sourcemap: false)";
      } catch (error) {
        found = error instanceof Error ? error.message : String(error);
      }
      cache.set(key, found);
    }
    if (typeof found === "string") {
      // Kept to ONE line per record; the store's contents are printed once at
      // the end instead of 50 times.
      console.log(`  [${found.split("\n")[0]}]`);
      console.log(details);
      missing = true;
    } else {
      stacksResolved += 1;
      printStack(found, details);
    }
    console.log("");
  }

  if (missing) {
    console.error(
      `[symbolicate] this store holds:\n${describeSymbolStore(symbolsDir)}`,
    );
  }
  // Every stack in the document failed to find symbols: the run did not do its
  // job (usually the wrong store), and exiting 0 would hide that behind a wall
  // of records that look symbolicated until you read them.
  if (stacksSeen > 0 && stacksResolved === 0) {
    console.error(
      `[symbolicate] none of the ${stacksSeen} stack(s) in this document ` +
        `found symbols in ${symbolsDir}`,
    );
    process.exit(1);
  }
} else if (values.symbols || values.release) {
  // ---- one stack on stdin, map found by releaseId ------------------------
  const symbolsDir = values.symbols;
  const releaseId = values.release;
  if (!symbolsDir || !releaseId) {
    console.error(
      "[symbolicate] --symbols <dir> and --release <id> go together",
    );
    usage();
  }
  if (positionals.length > 0) {
    console.error(
      "[symbolicate] pass a map path OR --symbols/--release, not both",
    );
    usage();
  }
  const entry = (() => {
    try {
      return readSymbolEntry({
        symbolsDir,
        releaseId,
        target: values.target,
      });
    } catch (error) {
      return fail(error);
    }
  })();
  if (!entry.mapPath) {
    fail(
      `release ${entry.releaseId} (${entry.target}) was stored without a map ` +
        "— it was built with `--no-sourcemap` / `{ sourcemap: false }`, and " +
        "no tooling can recover one after the fact.",
    );
  }
  console.error(`[symbolicate] ${entry.mapPath}`); // stderr: stdout is the stack
  printStack(tracerFor(entry.mapPath), readFileSync(0, "utf8"));
} else {
  // ---- the original mode: an explicit map path, stack on stdin -----------
  if (values.target !== undefined) {
    // `--target` only picks a directory inside a store; against an explicit
    // map path it selects nothing. Say so rather than accept it and resolve
    // the stack through the map the caller happened to name.
    console.error("[symbolicate] --target only means something with --symbols");
    usage();
  }
  const mapPath = positionals[0];
  if (!mapPath) usage();
  printStack(tracerFor(mapPath), readFileSync(0, "utf8"));
}
