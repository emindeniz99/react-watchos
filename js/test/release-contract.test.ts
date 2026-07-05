import { describe, expect, it } from "vitest";
import { hostMethods } from "../codegen/schema";
import { targets } from "../scripts/config";
import {
  providedFeatures,
  unprovidedFeatures,
} from "../scripts/releaseContract";

// ARCH-02: the declared capability contract. The SOUND check is `declared ⊆
// provided` — a bundle can't require a feature its target's native binary
// doesn't install (a typo, or asking the widget for a watch-only feature). This
// is what the build enforces before stamping the manifest.
describe("release capability contract (ARCH-02)", () => {
  it("every target only requires features its binary provides", () => {
    for (const target of targets) {
      expect(
        unprovidedFeatures(
          target.requiredFeatures,
          hostMethods,
          target.schemaTarget,
        ),
      ).toEqual([]);
    }
  });

  it("the widget bundle requires a subset of the widget binary's features", () => {
    const widget = targets.find((t) => t.name === "widget");
    expect(widget).toBeDefined();
    const provided = providedFeatures(hostMethods, "widget");
    for (const f of widget?.requiredFeatures ?? []) {
      expect(provided.has(f)).toBe(true);
    }
    // The widget binary genuinely lacks watch-only features, so declaring one is
    // the contract error this check exists to catch.
    expect(provided.has("network")).toBe(false);
    expect(unprovidedFeatures(["network"], hostMethods, "widget")).toEqual([
      "network",
    ]);
  });

  it("excludes the always-present 'core' infra from gateable features", () => {
    // core (commit/log/timers/invoke) ships with the bridge protocol, so it's
    // not a separately-declarable capability.
    expect(providedFeatures(hostMethods, "watch").has("core")).toBe(false);
  });

  it("a bogus feature is reported as unprovided (the typo guard)", () => {
    expect(
      unprovidedFeatures(["storage", "netwrok"], hostMethods, "watch"),
    ).toEqual(["netwrok"]);
  });
});
