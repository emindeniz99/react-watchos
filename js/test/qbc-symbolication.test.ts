import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TraceMap } from "@jridgewell/trace-mapping";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { watchBuildOptions } from "../esbuild/preset.mts";
import {
  type OriginalPosition,
  parseStackFrame,
  type StackFrame,
  symbolicateFrame,
} from "../scripts/symbolicate-core.ts";

/**
 * The production stack-position gate, end to end and with nothing simulated:
 *
 *   a .tsx that throws
 *     -> the REAL esbuild preset (minified, external source map)
 *     -> the REAL tools/qjs-compile (JS_WriteObject to .qbc)
 *     -> the REAL vendored quickjs-ng loading that .qbc through
 *        JS_ReadObject + JS_EvalFunction — the exact sequence
 *        JSRuntime.evaluateBytecode runs on the watch
 *     -> the Error.stack that comes back out
 *     -> the SHIPPED symbolicator (scripts/symbolicate-core.ts, which
 *        `pnpm symbolicate` is a thin CLI over)
 *     -> back to the .tsx, at the line and column that threw.
 *
 * Why the whole chain and not a unit test over `originalPositionFor`: the
 * thing that was broken could not be seen from either end. The build wrote a
 * perfectly good map, the map resolved perfectly good positions, and the CLI
 * worked — but the artifact the watch actually boots is bytecode, and
 * qjs-compile used to strip the debug tables out of it, so every real frame
 * read `at fn (<null>:0:1)` and there was nothing left to resolve. Only a test
 * that runs the real bytecode can tell those two worlds apart, which is why
 * the `<null>` assertion is the one that anchors the feature.
 */

const requireQjs = process.env.REQUIRE_QJS === "1";
const repoRoot = join(__dirname, "../..");
const vendorInclude = join(repoRoot, "js/swift/Sources/CQuickJS/include");
const fixtureEntry = join(__dirname, "fixtures/qbc-throw.entry.tsx");
const FIXTURE_SOURCE_RE = /test\/fixtures\/qbc-throw\.entry\.tsx$/;

// The engine objects are built once by tools/vendored-qjs/build.sh and shared
// by every C tool in the repo (see its header) — the same warm cache
// qjs-smoke.test.ts relies on. A fresh clone with no C compiler is the one
// thing that legitimately cannot run this, and that (only that) skips the
// suite; REQUIRE_QJS=1 turns the skip into a loud failure so CI can never
// silently drop the gate.
const objDir = (() => {
  try {
    return execFileSync(
      join(repoRoot, "tools/vendored-qjs/build.sh"),
      ["--objdir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ).trim();
  } catch {
    return "";
  }
})();
const qjsAvailable = objDir !== "";

/**
 * Compiles one of the repo's C tools against the prebuilt engine objects —
 * the same `cc` line tools/qjs-compile/run.sh uses — and caches the binary in
 * the OS tmpdir under a key covering everything that can change its output
 * (the C source, the engine objects, the compiler, the machine). Without the
 * cache every run of this file would relink the whole engine; with it a warm
 * run costs nothing.
 */
function buildTool(name: string): string {
  const source = join(repoRoot, "tools/qjs-compile", `${name}.c`);
  const objects = readdirSync(objDir)
    .filter((file) => file.endsWith(".o"))
    .sort()
    .map((file) => join(objDir, file));
  const cc = process.env.CC ?? "cc";
  const key = createHash("sha256");
  key.update(readFileSync(source));
  for (const object of objects) {
    const { size, mtimeMs } = statSync(object);
    key.update(`${object}:${size}:${mtimeMs}`);
  }
  key.update(`${cc}:${process.platform}:${process.arch}`);
  const binary = join(
    tmpdir(),
    `react-watchos-${name}-${key.digest("hex").slice(0, 16)}`,
  );
  if (!existsSync(binary)) {
    execFileSync(
      cc,
      [
        "-O2",
        "-std=gnu11",
        "-DNDEBUG",
        `-I${vendorInclude}`,
        "-o",
        binary,
        source,
        ...objects,
        "-lm",
        "-lpthread",
      ],
      { stdio: "pipe" },
    );
  }
  return binary;
}

// Read the fixture's line numbers OUT of the fixture rather than hardcoding
// them, so editing its comments can never silently make the assertions wrong.
const fixtureSource = readFileSync(fixtureEntry, "utf8").split("\n");
function fixtureLine(needle: string): number {
  const hits = fixtureSource
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => text.includes(needle));
  if (hits.length !== 1) {
    throw new Error(
      "qbc-symbolication: expected exactly one fixture line containing " +
        `${JSON.stringify(needle)}, found ${hits.length}`,
    );
  }
  return hits[0].line;
}

const throwLine = fixtureLine("// THROW_MARKER");
const callLine = fixtureLine("qbcSymbolicationInnerThrow(props.detail)");
const moduleCallLine = fixtureLine("QbcSymbolicationFixtureScreen({ detail:");

interface ResolvedFrame {
  frame: StackFrame;
  position: OriginalPosition | null;
}

describe.skipIf(!qjsAvailable && !requireQjs)(
  "production .qbc stack symbolication",
  () => {
    let stack = "";
    let frames: ResolvedFrame[] = [];
    let bundleLineCount = 0;
    let qbcBlob = "";

    beforeAll(async () => {
      // Reached with no compiler only under REQUIRE_QJS=1 (otherwise the suite
      // is skipped above) — fail with a message that names the fix.
      if (!qjsAvailable) {
        throw new Error(
          "REQUIRE_QJS=1 is set but the vendored quickjs-ng could not be " +
            "built. tools/vendored-qjs/build.sh needs a C compiler (cc). This " +
            "suite is the gate that the SHIPPED bytecode carries stack " +
            "positions at all, and must not be skipped in CI.",
        );
      }
      const dir = mkdtempSync(join(tmpdir(), "qbc-symbolication-"));
      const bundlePath = join(dir, "bundle.min.js");
      const qbcPath = join(dir, "bundle.qbc");

      // The SHIPPING shape: `buildBundles` minifies by default, and minify is
      // what makes symbolication necessary at all (locals are renamed, so the
      // frames below carry two-letter names, not the fixture's). `sourcemap`
      // defaults on and writes `<outfile>.map` as esbuild "external" — no
      // sourceMappingURL comment, so the bytes hashed into the OTA releaseId
      // are byte-identical with the map on or off.
      await build({
        ...watchBuildOptions({
          entry: fixtureEntry,
          outfile: bundlePath,
          minify: true,
        }),
        logLevel: "silent",
      });
      bundleLineCount = readFileSync(bundlePath, "utf8").split("\n").length;

      // The real compiler, not a stand-in: same flags, same engine, the blob
      // layout the watch reads.
      execFileSync(buildTool("qjs-compile"), [bundlePath, qbcPath], {
        stdio: "pipe",
      });
      qbcBlob = readFileSync(qbcPath).toString("latin1");

      // …and the real bytecode load path. Everything past this line is what
      // the watch itself would have reported.
      stack = execFileSync(buildTool("qbc-stack"), [qbcPath], {
        encoding: "utf8",
      });

      const tracer = new TraceMap(
        JSON.parse(
          readFileSync(`${bundlePath}.map`, "utf8"),
        ) as ConstructorParameters<typeof TraceMap>[0],
      );
      frames = stack
        .split("\n")
        .map((line) => parseStackFrame(line))
        .filter((frame): frame is StackFrame => frame !== null)
        .map((frame) => ({
          frame,
          position: symbolicateFrame({
            tracer,
            line: frame.line,
            column: frame.column,
          }),
        }));
    }, 180_000);

    /** Every frame whose ORIGINAL position landed on `line` of the fixture. */
    const framesAt = (line: number): ResolvedFrame[] => {
      const hits = frames.filter((f) => f.position?.line === line);
      if (hits.length === 0) {
        throw new Error(
          `no frame resolved to ${fixtureEntry}:${line}\nstack was:\n${stack}` +
            `\nresolved to:\n${frames
              .map(
                (f) =>
                  `  ${f.frame.name} (${f.frame.file}:${f.frame.line}:${f.frame.column})` +
                  ` -> ${f.position?.source}:${f.position?.line}:${f.position?.column}` +
                  ` [${f.position?.name}]`,
              )
              .join("\n")}`,
        );
      }
      return hits;
    };

    it("reports real file/line/column for every bytecode frame — no `<null>`", () => {
      // THE regression signature. JS_WRITE_OBJ_STRIP_DEBUG makes quickjs-ng
      // emit `at fn (<null>:0:1)` for every frame — a stack with no
      // information in it and a source map with nothing to resolve. If this
      // ever fails, someone put STRIP_DEBUG back in
      // tools/qjs-compile/qjs-compile.c.
      expect(stack).not.toContain("<null>");
      expect(frames.length).toBeGreaterThanOrEqual(3);
      for (const { frame, position } of frames) {
        // `bundle.js` is the name qjs-compile compiled under, so it is the
        // name baked into the bytecode's debug tables.
        expect(frame.file).toBe("bundle.js");
        expect(frame.line).toBeGreaterThan(0);
        expect(frame.column).toBeGreaterThan(0);
        expect(frame.line).toBeLessThanOrEqual(bundleLineCount);
        // Every frame of a bundle built from one fixture must resolve; a
        // "[no mapping]" here would mean the positions are noise.
        expect(position?.source).toMatch(FIXTURE_SOURCE_RE);
      }
      // esbuild does not emit one endless line (the app bundle is ~84), so a
      // frame line of 1 would be a constant rather than a measurement — this
      // is the guard against a test that would pass on a degenerate bundle.
      expect(bundleLineCount).toBeGreaterThan(1);
    });

    it("really ran a MINIFIED bundle, so the names had to be recovered", () => {
      // If the fixture's own identifiers had survived into the stack there
      // would be nothing for the map to do and this file would prove nothing.
      expect(stack).toContain(
        "qbc-symbolication fixture: thrown from bytecode",
      );
      expect(stack).not.toContain("qbcSymbolicationInnerThrow");
      expect(stack).not.toContain("QbcSymbolicationFixtureScreen");
    });

    it("resolves the throwing frame back to the .tsx line and column", () => {
      const position = framesAt(throwLine)[0].position;
      expect(position?.source).toMatch(FIXTURE_SOURCE_RE);
      expect(position?.line).toBe(throwLine);
      // Column precision, pinned without a magic number: the engine's column
      // lands inside the `new Error(...)` under construction, and the map's
      // name for exactly that column is the interpolated identifier. A column
      // off by even one token would not come back as `detail`.
      const text = fixtureSource[throwLine - 1];
      expect(position?.column).toBeGreaterThan(text.indexOf("throw"));
      expect(position?.column).toBeLessThanOrEqual(text.indexOf("// THROW"));
      expect(position?.name).toBe("detail");
    });

    it("resolves the calling frame too — a stack, not one lucky position", () => {
      const position = framesAt(callLine)[0].position;
      expect(position?.source).toMatch(FIXTURE_SOURCE_RE);
      expect(position?.line).toBe(callLine);
    });

    it("recovers the original function name minification erased", () => {
      // The engine's own frame names are the minified ones; the map's `names`
      // array is what puts `QbcSymbolicationFixtureScreen` back.
      expect(framesAt(moduleCallLine).map((f) => f.position?.name)).toContain(
        "QbcSymbolicationFixtureScreen",
      );
      expect(frames.map((f) => f.frame.name)).not.toContain(
        "QbcSymbolicationFixtureScreen",
      );
    });

    it("carries the original .tsx text in the map it resolved through", () => {
      expect(framesAt(throwLine)[0].position?.sourceContent).toContain(
        "// THROW_MARKER",
      );
    });

    it("still ships bytecode with the SOURCE stripped (STRIP_SOURCE stays)", () => {
      // The debug tables came back; the source text did not, and must not —
      // keeping it roughly quadruples the blob for stacks that are identical
      // either way. The visible consequence is that Function.prototype.toString
      // returns no source on the watch, which is the documented trade
      // (docs/debugging.md).
      expect(qbcBlob).not.toContain("throw new Error");
      expect(qbcBlob).not.toContain("qbcSymbolicationInnerThrow");
    });
  },
);
