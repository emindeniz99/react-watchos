import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { buildOptions } from "../scripts/config";

// Guards that the React Compiler is wired into the build: if the plugin is
// removed or stops emitting memoization, the compiler runtime won't be
// pulled in and this fails. (Auto-memoization -> fewer re-renders/commits.)
describe("react compiler", () => {
  // 60 s like build-preset's bundle-building tests: this compiles the full
  // production bundle through Babel + the React Compiler, and under the whole
  // suite's parallel load the 5 s default timed out twice on 2026-08-21/22
  // while passing every isolated run — load, not logic.
  it("is active in the built bundle", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "rc-")), "bundle.js");
    await build({ ...buildOptions(), outfile: out, logLevel: "silent" });
    const code = readFileSync(out, "utf8");
    expect(code).toContain("react/compiler-runtime");
  }, 60_000);
});
