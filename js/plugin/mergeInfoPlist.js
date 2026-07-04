// Pure Info.plist deep-merge used by the post-prebuild step
// (merge-target-infoplist.cjs). apple-targets@4.x writes targets/<name>/
// Info.plist ONLY when absent, and for `type: "watch"` the template it writes
// is an empty `<dict/>`. It never merges the `infoPlist` key from
// expo-target.config.js. So keys we rely on — CFBundleURLTypes (the
// `reactwatch://` deep-link scheme), WKRunsIndependentlyOfCompanionApp
// (standalone watch app), the HealthKit / CoreBluetooth / CoreMotion usage
// strings — would silently never reach the built app unless re-applied here.
//
// Kept free of any `@expo/config-plugins` import so it can be required from a
// standalone post-prebuild node script outside Expo's module resolution.

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `source` into `target`: nested plain objects merge recursively,
 * everything else (scalars, arrays) is replaced by the source value. Pure: does
 * not mutate either argument.
 * @template T
 * @param {unknown} target
 * @param {T} source
 * @returns {T}
 */
function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] = isPlainObject(value) ? deepMerge(target[key], value) : value;
  }
  // Merging two plain objects yields the source's shape with target keys
  // retained — Record-of-unknown structurally, T for the caller.
  return /** @type {T} */ (out);
}

module.exports = { deepMerge, isPlainObject };
