import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { buildOptions } from "../scripts/config.mjs";

// Guards that the React Compiler is wired into the build: if the plugin is
// removed or stops emitting memoization, the compiler runtime won't be
// pulled in and this fails. (Auto-memoization -> fewer re-renders/commits.)
describe("react compiler", () => {
  it("is active in the built bundle", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "rc-")), "bundle.js");
    await build({ ...buildOptions(), outfile: out, logLevel: "silent" });
    const code = readFileSync(out, "utf8");
    expect(code).toContain("react/compiler-runtime");
  });
});
