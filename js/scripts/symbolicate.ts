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
//   pnpm --filter react-watchos symbolicate dist/bundle.js.map < stack.txt
//   pbpaste | pnpm --filter react-watchos symbolicate dist/bundle.js.map
//
// Frames it cannot resolve are printed through UNCHANGED rather than dropped:
// a partly-symbolicated stack is still the stack, and silently eating a frame
// is how you lose the one that mattered.

import { readFileSync } from "node:fs";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

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

// quickjs-ng frames look like `    at name (/path/bundle.js:1:30)`, and the
// name is the MINIFIED one — `at n` — which is why the map's own name (when it
// has one for that position) is preferred below.
const FRAME = /^(\s*at\s+)(.*?)\s*\((.*):(\d+):(\d+)\)\s*$/;

const stack = readFileSync(0, "utf8");
for (const line of stack.split("\n")) {
  const match = FRAME.exec(line);
  if (!match) {
    console.log(line);
    continue;
  }
  const [, prefix, minifiedName, file, lineNo, colNo] = match;
  const position = originalPositionFor(tracer, {
    line: Number(lineNo),
    // Source maps are 0-based on columns; engines report 1-based.
    column: Number(colNo) - 1,
  });
  if (position.source == null) {
    console.log(`${line}   [no mapping]`);
    continue;
  }
  const name = position.name ?? minifiedName;
  console.log(
    `${prefix}${name} (${position.source}:${position.line}:${(position.column ?? 0) + 1})` +
      `   [was ${minifiedName} @ ${file.split("/").pop()}:${lineNo}:${colNo}]`,
  );
}
