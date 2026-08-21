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
// Frames it cannot resolve are printed through UNCHANGED rather than dropped:
// a partly-symbolicated stack is still the stack, and silently eating a frame
// is how you lose the one that mattered.

import { readFileSync } from "node:fs";
import { TraceMap } from "@jridgewell/trace-mapping";
import { parseStackFrame, symbolicateFrame } from "./symbolicate-core.ts";

const mapPath = process.argv[2];
if (!mapPath) {
  console.error(
    "usage: symbolicate <bundle.js.map>   (the stack arrives on stdin)\n" +
      "The map is written beside the bundle on every build — sourcemap is on " +
      "by default and costs the shipped bytes nothing (it is `external`, so no " +
      "sourceMappingURL comment is added).",
  );
  process.exit(2);
}

const tracer = new TraceMap(
  JSON.parse(readFileSync(mapPath, "utf8")) as ConstructorParameters<
    typeof TraceMap
  >[0],
);

const stack = readFileSync(0, "utf8");
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
