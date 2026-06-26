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

/**
 * Features a target's native binary provides — the gateable `feature`s of the
 * host methods that target installs. "core" is infra (always present with the
 * bridge protocol), so it's excluded from the gateable set.
 * @param {ReadonlyArray<{feature: string, targets: string[]}>} hostMethods
 * @param {string} schemaTarget e.g. "watch" | "widget"
 * @returns {Set<string>}
 */
export function providedFeatures(hostMethods, schemaTarget) {
  return new Set(
    hostMethods
      .filter((m) => m.targets.includes(schemaTarget) && m.feature !== "core")
      .map((m) => m.feature),
  );
}

/**
 * The declared features the target's binary does NOT provide — empty means the
 * bundle can run on that target. Non-empty is a contract error (fail the build).
 * @param {string[] | undefined} declared
 * @param {ReadonlyArray<{feature: string, targets: string[]}>} hostMethods
 * @param {string} schemaTarget
 * @returns {string[]}
 */
export function unprovidedFeatures(declared, hostMethods, schemaTarget) {
  const provided = providedFeatures(hostMethods, schemaTarget);
  return (declared ?? []).filter((f) => !provided.has(f));
}
