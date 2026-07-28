import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { components, propDegradations } from "../codegen/schema";

// M6-interim (2026-07-04 review): the case-presence contract test guarantees
// every primitive has a case in BOTH SwiftUI interpreters, but said nothing
// about the PROPS each case reads — per-prop behavior was parity-by-comment,
// and M4 (widget Gauge bounds) was that liability made concrete. Until the
// ARCH-10 single-interpreter refactor, this GOLDEN test pins the per-case
// prop-read sets of both interpreters: adding, removing, or renaming a prop
// read in one interpreter fails here until the committed golden is updated —
// a conscious, reviewable act that forces the "did the other interpreter need
// the same change?" question. Widget degradations (props the app reads and
// the widget deliberately ignores) are visible as app/widget set differences
// IN the golden, so they're documented rather than silent.
//
// Regenerate after an intentional change:
//   UPDATE_PARITY_GOLDEN=1 pnpm vitest run test/interpreter-prop-parity.test.ts
//
// The scan is source-shaped (regex over Swift declarations), which is exactly
// what makes it cheap and platform-independent: it runs on Linux with no
// SwiftUI. The contract is "extracted sets equal the golden", not a
// cross-interpreter set relation: the golden records whatever shape each side
// has today, and any CHANGE to either side's reads (the M4 drift moment)
// forces a conscious golden update.
//
// 2026-07-28 — the scan used to read ONLY `case "X":` block bodies, and that
// had a hole big enough for two real props to sit in undetected:
//
//   * `glass` is read in NodeView's top-level `body` modifier chain, which
//     applies to EVERY node, not inside any case.
//   * `buttonStyle` is read in the named helper `glassStyled`, which
//     `case "Button":` delegates to.
//
// Neither appeared in the golden, so the gate could not have caught either one
// diverging between the interpreters — and both HAVE diverged: the widget's
// `applyLayout` mirrors `LayoutModifier` only (no glass) and its `button(_:)`
// hard-codes `.buttonStyle(.plain)`, making both props silent no-ops in
// complications. A gate that can't see a prop can't defend it.
//
// So the scan now also covers:
//   1. the SHARED CHAIN — reads in each interpreter's top-level `body` and in
//      the helpers it applies to every node, recorded once under the
//      `__shared__` key rather than copied into all 41 components;
//   2. NAMED HELPERS — a case body that delegates to a helper declared in the
//      same file has that helper's reads folded in (transitively), so a
//      delegating case is no longer an empty set.
//
// The dispatch member itself (`rendered` / `render`) is deliberately NOT
// expanded from `body`: it contains the whole switch, so following it would
// collapse every component's reads into the shared set.
//
// Still not expanded, unchanged and deliberate: cross-file shared helpers
// (RNStyle/RNFormat/RNUI) are parity by construction — they are ONE copy, so
// there is nothing to drift — and separate `View` structs (CrownRotationView,
// OptimisticTextField) are their own types rather than helpers of the walk.

const jsRoot = join(__dirname, "..");
const goldenPath = join(__dirname, "interpreter-prop-parity.golden.json");
const interpreters = {
  app: join(jsRoot, "swift/Sources/ReactWatchHost/NodeView.swift"),
  widget: join(jsRoot, "swift/Sources/ReactWatchWidget/ReactWidgetView.swift"),
} as const;

/** Where the shared-chain read set is recorded in the golden. Not a component
 *  name, so it can't collide with one. */
const SHARED_KEY = "__shared__";

/** The member each interpreter's `body` delegates the switch to. Expanding it
 *  from `body` would pull every case into the shared set. */
const dispatchMember = { app: "rendered", widget: "render" } as const;

/** A `case` label position that starts a PascalCase component block. */
interface CaseSite {
  names: string[];
  bodyStart: number;
}

/** The wire prop names read directly in one span of Swift source. */
function readsIn(body: string): Set<string> {
  const reads = new Set<string>();
  // node.<accessor>("prop") — the wire prop reads.
  for (const m of body.matchAll(
    /\bnode\.(?:string|double|bool|int|stringArray|json)\("(\w+)"\)/g,
  )) {
    reads.add(m[1] as string);
  }
  // cgFloat("prop") / cgFloat(node, "prop") — the shared CGFloat helper.
  for (const m of body.matchAll(/\bcgFloat\((?:node,\s*)?"(\w+)"\)/g)) {
    reads.add(m[1] as string);
  }
  return reads;
}

/**
 * Every `func`/`var` in the file whose declaration is immediately followed by a
 * brace, mapped to its balanced-brace body. Stored properties (`let node:
 * RNNode`, `@ScaledMetric private var pickerMinHeight: CGFloat = 90`) have no
 * brace and are skipped, so a helper name can't accidentally bind to the next
 * declaration's body.
 */
function declarationBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const decl =
    /\b(?:func|var)\s+(\w+)\s*(?:\([^)]*\))?\s*(?::[^={\n]+?)?\s*(?:->[^{\n]+?)?\s*\{/g;
  for (const m of src.matchAll(decl)) {
    const open = (m.index as number) + (m[0] as string).length - 1;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) {
        // First declaration wins — matches `functionBody`'s "first match".
        if (!out.has(m[1] as string)) {
          out.set(m[1] as string, src.slice(open + 1, i));
        }
        break;
      }
    }
  }
  return out;
}

/**
 * Reads in `body`, plus the reads of every same-file helper it calls,
 * transitively. `skip` blocks the dispatch member (and guards recursion).
 */
function readsWithHelpers(
  body: string,
  decls: Map<string, string>,
  skip: Set<string>,
): Set<string> {
  const reads = readsIn(body);
  for (const m of body.matchAll(/\b(\w+)\b/g)) {
    const name = m[1] as string;
    if (skip.has(name) || !decls.has(name)) continue;
    skip.add(name);
    for (const r of readsWithHelpers(decls.get(name) as string, decls, skip)) {
      reads.add(r);
    }
  }
  return reads;
}

/** Per-component prop reads extracted from one interpreter source. */
function propReads(file: string, dispatch: string): Record<string, string[]> {
  const src = readFileSync(file, "utf8");
  const decls = declarationBodies(src);
  // Every `case … :` label (component blocks end at ANY sibling label or
  // `default:` — nested value-switches inside a body are rare in the
  // interpreters and shared helpers carry their own parity).
  const labels = [...src.matchAll(/\bcase\b[^:{\n]*?:/g)];
  const sites: CaseSite[] = [];
  for (const label of labels) {
    const names = [...(label[0] as string).matchAll(/"([A-Z]\w+)"/g)].map(
      (m) => m[1] as string,
    );
    if (names.length === 0) continue;
    sites.push({
      names,
      bodyStart: (label.index as number) + (label[0] as string).length,
    });
  }
  const out: Record<string, string[]> = {};
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i] as CaseSite;
    // The block runs to the NEXT case/default label after this one (grouped
    // labels share one body, so all names get the same set).
    const next = src
      .slice(site.bodyStart)
      .search(/\bcase\b[^:{\n]*?:|\bdefault:/);
    const body = src.slice(
      site.bodyStart,
      next === -1 ? src.length : site.bodyStart + next,
    );
    // Fold in the reads of any same-file helper this case delegates to — the
    // `case "Button": buttonView` -> `glassStyled` -> `buttonStyle` chain that
    // used to leave a delegating case looking like it read nothing.
    const reads = readsWithHelpers(body, decls, new Set([dispatch]));
    for (const name of site.names) {
      const merged = new Set([...(out[name] ?? []), ...reads]);
      out[name] = [...merged].sort();
    }
  }
  // The shared chain: everything `body` applies to EVERY node (the app's
  // LayoutModifier/GlassModifier/A11y/Gesture/SwipeActions chain, the widget's
  // applyLayout/applyA11y), minus the switch it dispatches through.
  const bodySrc = decls.get("body");
  out[SHARED_KEY] = bodySrc
    ? [...readsWithHelpers(bodySrc, decls, new Set([dispatch]))].sort()
    : [];
  return out;
}

/** The balanced-brace body of a Swift `func <name>(` (first match), or null. */
function functionBody(src: string, name: string): string | null {
  const sig = src.search(new RegExp(`\\bfunc ${name}\\b`));
  if (sig === -1) return null;
  const open = src.indexOf("{", sig);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

describe("interpreter per-prop parity (M6-interim golden)", () => {
  const extracted: Record<string, { app: string[]; widget: string[] }> = {};
  const app = propReads(interpreters.app, dispatchMember.app);
  const widget = propReads(interpreters.widget, dispatchMember.widget);
  for (const c of components as { name: string }[]) {
    extracted[c.name] = {
      app: app[c.name] ?? [],
      widget: widget[c.name] ?? [],
    };
  }
  // Props applied to every node rather than to one component. `glass` lives
  // here, and the golden showing it app-only IS the record of the complication
  // no-op documented in components.ts.
  extracted[SHARED_KEY] = {
    app: app[SHARED_KEY] ?? [],
    widget: widget[SHARED_KEY] ?? [],
  };

  it("matches the committed golden (update it CONSCIOUSLY on prop changes)", () => {
    if (process.env.UPDATE_PARITY_GOLDEN) {
      writeFileSync(goldenPath, `${JSON.stringify(extracted, null, 2)}\n`);
    }
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    expect(extracted).toEqual(golden);
  });

  it("every contract component appears in the golden (no silent additions)", () => {
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    expect(Object.keys(golden).sort()).toEqual(
      [
        SHARED_KEY,
        ...(components as { name: string }[]).map((c) => c.name),
      ].sort(),
    );
  });

  // The two props this scan was widened to see. Pinned by NAME, not just by
  // "the golden matches": the golden is regenerated wholesale, so a future
  // refactor that moved these reads back out of the scan's reach would update
  // the golden quietly and take the gate down with it. These assertions fail
  // loudly instead.
  it("sees `glass` (shared chain) and `buttonStyle` (named helper)", () => {
    expect(
      extracted[SHARED_KEY]?.app,
      "`glass` is read in NodeView.body's modifier chain — the scan must " +
        "cover the shared chain, not only case blocks",
    ).toContain("glass");
    expect(
      extracted.Button?.app,
      "`buttonStyle` is read in the glassStyled helper — the scan must " +
        "follow a case's delegation",
    ).toContain("buttonStyle");
  });

  // A2: close the loop between the DECLARED prop degradations (schema.ts ->
  // docs/api/capabilities.md) and the EXTRACTED evidence. Every documented
  // "the widget ignores this prop" has to be a prop the app really reads and
  // the widget really doesn't — so the docs can't claim a no-op that was since
  // fixed, and a fixed no-op can't keep its warning. Closing a gap means
  // deleting its row here AND regenerating the golden; both are conscious.
  it("every declared prop degradation is app-only in the extracted golden", () => {
    for (const d of propDegradations as {
      component: string;
      prop: string;
    }[]) {
      const key = d.component === "*" ? SHARED_KEY : d.component;
      const entry = extracted[key];
      expect(entry, `${key} is scanned`).toBeTruthy();
      expect(
        entry?.app,
        `${key}.${d.prop} is declared a widget-only degradation, so the APP ` +
          "interpreter must actually read it",
      ).toContain(d.prop);
      expect(
        entry?.widget,
        `${key}.${d.prop} is documented as a complication no-op, but the ` +
          "widget interpreter reads it — delete the propDegradations row",
      ).not.toContain(d.prop);
    }
  });

  // Rich-text fold parity is now STRUCTURAL: ARCH-10 Phase A moved textSegment
  // into the shared ReactWatchUI module, so both interpreters call ONE copy
  // (RNUI.textSegment) instead of maintaining two that can drift — the exact
  // drift that once dropped >=2-deep nesting on the complication. Guard that the
  // single shared copy still recurses, and that neither interpreter has grown
  // its own copy back. Companion wire test: richtext.test.tsx ">=2 deep".
  it("the shared textSegment folds nested <Text> children (parity is structural)", () => {
    const shared = join(jsRoot, "swift/Sources/ReactWatchUI/RNUI.swift");
    const body = functionBody(readFileSync(shared, "utf8"), "textSegment");
    expect(body, "ReactWatchUI defines the shared textSegment").toBeTruthy();
    expect(
      (body as string).includes("node.children"),
      "shared textSegment must fold element children, not read text only",
    ).toBe(true);
    expect(
      /\btextSegment\(/.test(body as string),
      "shared textSegment must recurse into nested segments",
    ).toBe(true);
    for (const [name, file] of Object.entries(interpreters)) {
      expect(
        functionBody(readFileSync(file, "utf8"), "textSegment"),
        `${name} must NOT redefine textSegment — call RNUI.textSegment`,
      ).toBeNull();
    }
  });
});
