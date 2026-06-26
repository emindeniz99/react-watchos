import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ARCH-02 (acceptance criterion 4): application code must reach native
// capabilities ONLY through the typed API (fetch, generateText, Storage,
// scheduleNotification, …), never the raw `__host` bridge. This is the enabling
// invariant for ANY capability-derivation: if app code could call
// `globalThis.__host.<anything>` directly, a static feature contract could never
// see it (the "dynamic/direct bridge calls evade the mapping" hole the review
// flags). The framework's own binding layer (js/src/*) legitimately owns
// `__host`; this guard covers the demo app — the canonical consumer.
//
// `__hostFeatures` / `__bridgeProtocol` (the capability *introspection* globals)
// are deliberately allowed — they're read-only signals, not the call bridge.
const demoDir = join(__dirname, "..", "demo");
const appFiles = [
  "App.tsx",
  "widgets.tsx",
  "shoppingStore.ts",
  "hydrationStore.ts",
  "intents.ts",
  "app.entry.tsx",
  "widget.entry.tsx",
];

/** Matches the raw bridge (`__host`, `__host.`, `__host?.`) but not the allowed
 *  introspection globals (`__hostFeatures`). */
const RAW_HOST = /\b__host(?!Features)\b/;

describe("ARCH-02: app code uses the typed API, not the raw __host bridge", () => {
  for (const file of appFiles) {
    it(`${file} never touches __host directly`, () => {
      const src = readFileSync(join(demoDir, file), "utf8");
      const offenders = src
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => RAW_HOST.test(line));
      expect(
        offenders,
        `app code must call native capabilities through the typed API, not ` +
          `globalThis.__host directly (ARCH-02). Offending lines:\n` +
          offenders.map(([n, l]) => `  ${file}:${n}: ${l.trim()}`).join("\n"),
      ).toEqual([]);
    });
  }
});
