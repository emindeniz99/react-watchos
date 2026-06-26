import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CX-026: ShoppingIntent.swift is duplicated across the watch app and widget
// extension targets because BOTH must compile the AppIntent the configurable
// Shopping widget resolves, and @bacons/apple-targets discovers Swift per
// target folder (a single file shared across both targets needs pbxproj
// membership wiring + a prebuild to verify — out of scope here). The real risk
// of the duplication is the two copies silently DRIFTING. This guard fails the
// build the moment they differ, the same way component-contract.test guards the
// two SwiftUI interpreters — so the duplication can't become a correctness bug.
const appRoot = join(__dirname, "..", "..", "app");

/** Target-dir-relative paths that must stay byte-identical across targets. */
const duplicatedSources = ["ShoppingIntent.swift"];

describe("duplicated target sources stay in sync (CX-026)", () => {
  for (const rel of duplicatedSources) {
    it(`${rel} is identical in the watch and widget targets`, () => {
      const watch = readFileSync(
        join(appRoot, "targets", "watch", rel),
        "utf8",
      );
      const widget = readFileSync(
        join(appRoot, "targets", "widget", rel),
        "utf8",
      );
      expect(
        widget,
        `${rel} has drifted between app/targets/watch and app/targets/widget. ` +
          `Both targets compile this file (CX-026) — edit them together, or ` +
          `dedup via shared pbxproj target membership.`,
      ).toBe(watch);
    });
  }
});
