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
});
