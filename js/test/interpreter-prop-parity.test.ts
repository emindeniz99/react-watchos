import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { components } from "../codegen/schema.mjs";

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
// The scan is source-shaped (regex over `case "X":` blocks), which is exactly
// what makes it cheap and platform-independent: it runs on Linux with no
// SwiftUI. Two deliberate limits: shared helpers (RNStyle/RNFormat/
// applyLayout) are parity by construction and not expanded, and a case that
// DELEGATES to a sub-view (the app's `case "Image": imageView`,
// CrownRotationView, OptimisticTextField) contributes an empty/short set —
// its reads live outside the block. That's why the contract is "extracted
// sets equal the golden", not a cross-interpreter set relation: the golden
// records whatever shape each side has today, and any CHANGE to either
// side's reads (the M4 drift moment) forces a conscious golden update.

const jsRoot = join(__dirname, "..");
const goldenPath = join(__dirname, "interpreter-prop-parity.golden.json");
const interpreters = {
  app: join(jsRoot, "swift/Sources/ReactWatchHost/NodeView.swift"),
  widget: join(jsRoot, "swift/Sources/ReactWatchWidget/ReactWidgetView.swift"),
} as const;

/** A `case` label position that starts a PascalCase component block. */
interface CaseSite {
  names: string[];
  bodyStart: number;
}

/** Per-component prop reads extracted from one interpreter source. */
function propReads(file: string): Record<string, string[]> {
  const src = readFileSync(file, "utf8");
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
    for (const name of site.names) {
      const merged = new Set([...(out[name] ?? []), ...reads]);
      out[name] = [...merged].sort();
    }
  }
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
  const app = propReads(interpreters.app);
  const widget = propReads(interpreters.widget);
  for (const c of components as { name: string }[]) {
    extracted[c.name] = {
      app: app[c.name] ?? [],
      widget: widget[c.name] ?? [],
    };
  }

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
      (components as { name: string }[]).map((c) => c.name).sort(),
    );
  });

  // The golden above tracks prop READS, not control flow, so it is structurally
  // blind to a recursion drift: the widget's textSegment once built a flat Text
  // and did NOT fold a segment's own <Text> children, so rich text nested >=2
  // deep dropped its deepest text on the complication only (the app folded it
  // correctly). Neither the build nor the golden caught it. Pin the structural
  // invariant directly until ARCH-10 Phase A makes textSegment ONE shared
  // function tested once. Companion wire test: richtext.test.tsx ">=2 deep".
  it("both interpreters' textSegment folds nested <Text> children (rich-text parity)", () => {
    for (const [name, file] of Object.entries(interpreters)) {
      const body = functionBody(readFileSync(file, "utf8"), "textSegment");
      expect(body, `${name} interpreter defines textSegment`).toBeTruthy();
      expect(
        (body as string).includes("node.children"),
        `${name} textSegment must fold element children, not read text only`,
      ).toBe(true);
      expect(
        /\btextSegment\(/.test(body as string),
        `${name} textSegment must recurse into nested segments`,
      ).toBe(true);
    }
  });
});
