import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M9: the vendored quickjs-ng engine is the ENTIRE trust base — it executes
// 100% of app JS including every signed OTA bundle. The vendor script pins the
// upstream tarball's SHA-256 at re-vendor time; this test pins the vendored
// tree between re-vendors, so a silent local edit (or a compromised checkout)
// of the engine C can't ride along unnoticed with unrelated changes. Runs in
// the ordinary suite, so it gates every `pnpm test` even while CI is dark.
const VENDOR = join(__dirname, "..", "swift", "Sources", "CQuickJS");

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function parseManifest(): Map<string, string> {
  const lines = readFileSync(join(VENDOR, "CHECKSUMS.sha256"), "utf8")
    .trim()
    .split("\n");
  const map = new Map<string, string>();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (!match) throw new Error(`malformed manifest line: ${line}`);
    map.set(match[2] as string, match[1] as string);
  }
  return map;
}

describe("vendored quickjs-ng integrity (M9)", () => {
  it("every vendored engine file hashes to the committed manifest", () => {
    const manifest = parseManifest();
    expect(manifest.size).toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (const [rel, expected] of manifest) {
      const actual = sha256(join(VENDOR, rel));
      if (actual !== expected) mismatches.push(`${rel}: ${actual}`);
    }
    expect(
      mismatches,
      "engine files changed without re-vendoring — if intentional, re-run " +
        "tools/vendor-quickjs/run.sh (which regenerates CHECKSUMS.sha256) " +
        "or update the manifest deliberately",
    ).toEqual([]);
  });

  it("no unmanifested file exists in the vendored tree", () => {
    // A file ADDED next to the engine (e.g. a smuggled .c that a build tweak
    // then compiles) must show up too, not just modifications.
    const manifest = parseManifest();
    const actual: string[] = [];
    for (const f of readdirSync(VENDOR)) {
      if (f === "CHECKSUMS.sha256" || f === "VERSION.md" || f === "include")
        continue;
      actual.push(f);
    }
    for (const f of readdirSync(join(VENDOR, "include"))) {
      actual.push(`include/${f}`);
    }
    const unmanifested = actual.filter((f) => !manifest.has(f));
    expect(unmanifested).toEqual([]);
  });
});
