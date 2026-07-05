import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The set of SwiftUI semantic color NAMES lives in three hand-written places
// that must agree, or a color silently misbehaves:
//   1. TS `SystemColorName` union (src/components.ts) — consumer autocomplete +
//      typo-catch on color props.
//   2. Swift `RNStyle.namedColors` (the shared kernel) — decides which names
//      PARSE as a named color vs fall through to hex/nil.
//   3. `RNUI.systemColor` switch (the shared interpreter helper) — maps a parsed
//      name to an actual `SwiftUI.Color`.
// Drift is silent: a name in (2) but not (3) parses then maps to `.primary`
// (wrong color, no error); a name in (1) but not (2) autocompletes for
// consumers but never renders. This golden pins all three equal — a
// source-shaped scan (like interpreter-prop-parity), so it runs on Linux with
// no SwiftUI. When you add a color, add it in all three or this fails.
//
// NOTE ON APPLE ADDING COLORS: this guards OUR three lists against each other.
// If Apple *removes* a SwiftUI color, the watchOS build breaks (RNUI.systemColor
// won't compile) — caught. If Apple *adds* one, nothing here tells you; that's
// the manual "watch the SDK / check availability" discipline. This test is the
// internal-consistency half.

const jsRoot = join(__dirname, "..");
const componentsPath = join(jsRoot, "src/components.ts");
const rnStylePath = join(jsRoot, "swift/Sources/ReactWatchSupport/RNStyle.swift");
const rnuiPath = join(jsRoot, "swift/Sources/ReactWatchUI/RNUI.swift");

/** String literals inside the first `SystemColorName` union declaration. */
function tsColorNames(): string[] {
  const src = readFileSync(componentsPath, "utf8");
  const block = src.match(/export type SystemColorName =([\s\S]*?);/);
  if (!block) throw new Error("SystemColorName union not found");
  return [...block[1].matchAll(/"(\w+)"/g)].map((m) => m[1] as string).sort();
}

/** String literals inside the `namedColors: Set<String> = [ … ]` array. */
function swiftNamedColors(): string[] {
  const src = readFileSync(rnStylePath, "utf8");
  const block = src.match(/namedColors:\s*Set<String>\s*=\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error("RNStyle.namedColors set not found");
  return [...block[1].matchAll(/"(\w+)"/g)].map((m) => m[1] as string).sort();
}

/** `case "X":` labels inside `RNUI.systemColor`'s switch (excludes default). */
function rnuiColorCases(): string[] {
  const src = readFileSync(rnuiPath, "utf8");
  const start = src.search(/func systemColor\b/);
  if (start === -1) throw new Error("RNUI.systemColor not found");
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = src.slice(open, end);
  return [...body.matchAll(/case "(\w+)":/g)].map((m) => m[1] as string).sort();
}

describe("system color name parity (TS ↔ Swift kernel ↔ interpreter)", () => {
  const ts = tsColorNames();
  const kernel = swiftNamedColors();
  const interpreter = rnuiColorCases();

  it("finds a non-trivial set in all three sources (scan didn't silently break)", () => {
    expect(ts.length).toBeGreaterThan(10);
    expect(kernel.length).toBe(ts.length);
    expect(interpreter.length).toBe(ts.length);
  });

  it("TS SystemColorName == Swift RNStyle.namedColors", () => {
    expect(ts).toEqual(kernel);
  });

  it("Swift RNStyle.namedColors == RNUI.systemColor cases (no silent .primary)", () => {
    expect(kernel).toEqual(interpreter);
  });
});
