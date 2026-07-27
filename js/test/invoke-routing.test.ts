import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostMethods } from "../codegen/schema";

// The third (and last) unguarded seam of the SD-1 invoke channel. The schema
// <-> Swift-router pair is pinned bidirectionally by codegen.test.ts ("the host
// routes exactly the schema's invoke methods"), but the JS CALLERS pass bare
// string literals: `invoke("keychainGet")` misspelled in js/src compiles,
// type-checks, lints, and passes every other test file — it surfaces only as a
// runtime UNKNOWN_METHOD on a physical watch (and in the widget runtime, whose
// rejecter is name-only by design). This mirrors the Swift-side check on the
// JS side, in both directions.

const srcDir = join(__dirname, "../src");

/** Every `.ts`/`.tsx` under js/src, recursively. `generated/` is excluded: it
 *  is codegen output (the HOST_METHODS manifest quotes every method name, which
 *  is a declaration, not a call site). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "generated") continue;
      out.push(...sourceFiles(join(dir, entry.name)));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** `invoke("m")` / `invoke<T>("m")` / `await invoke<T>(\n  "m",` — the call
 *  shapes the wrappers actually use. A leading `.` is excluded so
 *  `host.invoke?.(...)` (the raw bridge call inside invoke.ts) can't match. */
const CALL = /(?<![.\w])invoke\s*(?:<[^;{}()]*?>)?\s*\(\s*"([A-Za-z0-9_]+)"/g;

function calledMethods(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(srcDir)) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(CALL)) {
      const name = match[1] as string;
      const sites = found.get(name);
      if (sites) sites.push(file);
      else found.set(name, [file]);
    }
  }
  return found;
}

const declared = new Set(
  hostMethods.filter((m) => m.via === "invoke").map((m) => m.name),
);

describe("invoke routing (JS callers)", () => {
  it("every invoke() literal in js/src is a declared schema invoke method", () => {
    // Forward: a typo'd or renamed literal has no schema entry, so it would
    // reject UNKNOWN_METHOD at runtime on the watch. Fail here instead.
    const called = calledMethods();
    const undeclared = [...called]
      .filter(([name]) => !declared.has(name))
      .map(([name, files]) => `${name} (${files.join(", ")})`);
    expect(undeclared).toEqual([]);
  });

  it("every schema invoke method has a JS caller", () => {
    // Reverse: a `via:"invoke"` method nothing calls is either dead weight in
    // the schema (which still costs the widget/OTA capability taxonomy an
    // entry) or a wrapper someone forgot to write. The routing test's reverse
    // direction is what caught the enableWaterLock gap on the Swift side.
    const called = new Set(calledMethods().keys());
    const uncalled = [...declared].filter((name) => !called.has(name));
    expect(uncalled).toEqual([]);
  });

  it("the caller scan actually finds the wrappers (guards the regex)", () => {
    // A regex that matched nothing would make BOTH directions above vacuous in
    // one direction and noisy in the other; pin a few known-awkward shapes:
    // a bare call, a generic call, and a multi-line call whose literal is on
    // its own line (notifications.ts / iap.ts).
    const called = calledMethods();
    expect(called.has("stopAudio")).toBe(true); // invoke("stopAudio")
    expect(called.has("getDeviceInfo")).toBe(true); // invoke<DeviceInfo>(...)
    expect(called.has("requestNotificationPermission")).toBe(true); // multi-line
    expect(called.has("purchase")).toBe(true); // multi-line + generic
    expect(called.size).toBe(declared.size);
  });
});
