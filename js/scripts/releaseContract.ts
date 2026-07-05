// The bundle's declared capability contract (ARCH-02): which native features an
// OTA bundle needs, stamped into the manifest so the ARCH-01 gate works without
// the publisher hand-passing them. Pure helpers, shared by build.mjs (stamp +
// validate) and the release-contract test.
//
// SOUNDNESS NOTE: this validates `declared ⊆ provided` — a bundle can't declare
// a feature its target's binary doesn't have (a typo, or a feature the widget
// target lacks). It does NOT verify `declared ⊇ used` (that the bundle declared
// every feature it actually calls): the bundle imports the whole framework and
// capability modules can self-register, so import/usage scanning is not a sound
// authority. Under-declaring therefore stays the developer's responsibility;
// over-declaring is safe (a stricter gate). See docs/code-review … ARCH-02.

/** The subset of a host method this contract reads (structural, so both the
 *  schema's `hostMethods` and test fixtures satisfy it). */
type FeatureMethod = { feature: string; targets: readonly string[] };

/**
 * Features a target's native binary provides — the gateable `feature`s of the
 * host methods that target installs. "core" is infra (always present with the
 * bridge protocol), so it's excluded from the gateable set.
 * @param schemaTarget e.g. "watch" | "widget"
 */
export function providedFeatures(
  hostMethods: readonly FeatureMethod[],
  schemaTarget: string,
): Set<string> {
  return new Set(
    hostMethods
      .filter((m) => m.targets.includes(schemaTarget) && m.feature !== "core")
      .map((m) => m.feature),
  );
}

/**
 * The declared features the target's binary does NOT provide — empty means the
 * bundle can run on that target. Non-empty is a contract error (fail the build).
 */
export function unprovidedFeatures(
  declared: string[] | undefined,
  hostMethods: readonly FeatureMethod[],
  schemaTarget: string,
): string[] {
  const provided = providedFeatures(hostMethods, schemaTarget);
  return (declared ?? []).filter((f) => !provided.has(f));
}
