import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { components } from "../codegen/schema.mjs";

// CX-024 / SD-6: the component contract (codegen/schema.mjs `components`) is the
// single source of truth for the primitive vocabulary. Both SwiftUI
// interpreters switch on `node.type` with a `default:` (logs + skips unknown
// types for forward-compat), so Swift can't enforce exhaustiveness — this test
// does: every contract primitive must have a `case` in BOTH interpreters, so a
// primitive can't be handled in one and silently dropped in the other (the
// CX-018 class of drift). It also fails if an interpreter handles a PascalCase
// type the contract doesn't list, keeping the contract complete.
const jsRoot = join(__dirname, "..");
const appInterpreter = join(
  jsRoot,
  "swift/Sources/ReactWatchHost/NodeView.swift",
);
const widgetInterpreter = join(
  jsRoot,
  "swift/Sources/ReactWatchWidget/ReactWidgetView.swift",
);

/** PascalCase string literals in a `case … :` label — the primitive type names.
 *  Reads the whole label (up to the `:`), so a grouped `case "A", "B", …:` that
 *  wraps across lines is covered. Lowercase cases (color names, date components,
 *  haptics) are excluded since component types are PascalCase. */
function caseTypes(file: string): Set<string> {
  const src = readFileSync(file, "utf8");
  const types = new Set<string>();
  for (const label of src.matchAll(/\bcase\b([^:]*?):/g)) {
    for (const m of label[1].matchAll(/"([A-Z]\w+)"/g)) {
      types.add(m[1] as string);
    }
  }
  return types;
}

describe("component contract (interpreter drift guard)", () => {
  const contract = new Set(components.map((c) => c.name));

  it("the app interpreter (NodeView) handles exactly the contract primitives", () => {
    expect([...caseTypes(appInterpreter)].sort()).toEqual([...contract].sort());
  });

  it("the widget interpreter (WidgetNodeView) handles exactly the contract primitives", () => {
    // Interactive primitives are degraded in the widget, but every one must
    // still have a case (graceful render) — not be silently dropped.
    expect([...caseTypes(widgetInterpreter)].sort()).toEqual(
      [...contract].sort(),
    );
  });

  it("every contract entry declares a valid widget support level", () => {
    for (const c of components) {
      expect(["full", "degraded"]).toContain(c.widget);
    }
  });
});
