import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash } from "../esbuild/manifest.mjs";
import { buildBundles } from "../esbuild/preset.mjs";

// The batteries-included multi-target build: a consumer with a watch bundle +
// a widget bundle calls this once instead of copying the esbuild boilerplate
// per target. The contract that matters: every target is built through the
// preset, and `manifest` stamps OTA `manifest.json` next to *that* bundle only
// (the app bundle is OTA'd; the widget bundle is shipped) — so a drift here
// would silently leave a widget un-OTA'd or an app bundle un-stamped.
describe("buildBundles", () => {
  it("builds every target and stamps a manifest only where asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-build-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, "export const x = 1;\n");
    // A non-default outfile name (app.js, not bundle.js) — the manifest must
    // still track THIS file, not a hardcoded bundle.js (regression guard).
    const watchOut = join(dir, "watch/app.js");
    const widgetOut = join(dir, "widget/bundle.js");

    const results = await buildBundles([
      {
        name: "watch",
        entry,
        outfile: watchOut,
        manifest: { version: 2, requiredFeatures: ["core"] },
      },
      { name: "widget", entry, outfile: widgetOut },
    ]);

    expect(existsSync(watchOut)).toBe(true);
    expect(existsSync(widgetOut)).toBe(true);
    // Manifest next to the watch bundle, not the widget.
    expect(existsSync(join(dir, "watch/manifest.json"))).toBe(true);
    expect(existsSync(join(dir, "widget/manifest.json"))).toBe(false);

    const watch = results.find((r) => r.name === "watch");
    expect(watch?.manifest?.version).toBe(2);
    expect(watch?.manifest?.requiredFeatures).toEqual(["core"]);
    // `bundle` + `releaseId` track the actual outfile (app.js), not bundle.js.
    expect(watch?.manifest?.bundle).toBe("app.js");
    expect(watch?.manifest?.releaseId).toBe(
      contentHash(readFileSync(watchOut, "utf8")),
    );
    expect(results.find((r) => r.name === "widget")?.manifest).toBeUndefined();
  });

  it("rejects an empty target list (a no-op build is a mistake)", async () => {
    await expect(buildBundles([])).rejects.toThrow(/non-empty/);
  });

  // QuickJS has no `process`, so a `process.env.BUNDLE_VERSION` that survives to
  // runtime crashes the whole bundle at load — the exact thing that only bites
  // the shipped consumer path (the in-repo build + Node tests both have it
  // defined). It must be statically replaced, and from manifest.version so the
  // two stay in lockstep.
  it("bakes BUNDLE_VERSION from manifest.version; never leaves a raw process.env read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-bv-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, "export const v = process.env.BUNDLE_VERSION;\n");

    const appOut = join(dir, "app.js");
    await buildBundles([
      { name: "app", entry, outfile: appOut, manifest: { version: 4 } },
    ]);
    const app = readFileSync(appOut, "utf8");
    expect(app).not.toContain("process.env.BUNDLE_VERSION"); // would crash in QuickJS
    expect(app).toContain('"4"'); // == manifest.version, not a hardcoded default

    // A target with NO manifest still gets the preset default, so any bundle
    // that happens to read BUNDLE_VERSION can't crash either.
    const widgetOut = join(dir, "widget.js");
    await buildBundles([{ name: "widget", entry, outfile: widgetOut }]);
    expect(readFileSync(widgetOut, "utf8")).not.toContain(
      "process.env.BUNDLE_VERSION",
    );
  });
});
