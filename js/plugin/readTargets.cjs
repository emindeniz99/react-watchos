const fs = require("node:fs");
const path = require("node:path");

// Reads back the apple-targets config files the plugin generated under
// targets/<dir>/expo-target.config.js. Shared by the post-prebuild scripts so
// they discover the resolved target names / types / infoPlist without
// re-parsing the Expo config (the generated files are the resolved truth).

/** @returns {Array<{ dir: string, name: string, type: string, config: object }>} */
function readGeneratedTargets(projectRoot) {
  const targetsDir = path.join(projectRoot, "targets");
  if (!fs.existsSync(targetsDir)) return [];
  const out = [];
  for (const dir of fs.readdirSync(targetsDir)) {
    const configPath = path.join(targetsDir, dir, "expo-target.config.js");
    if (!fs.existsSync(configPath)) continue;
    // The generated files are plain `module.exports = <object>`; a consumer's
    // hand-authored file may still be a function — handle both.
    delete require.cache[require.resolve(configPath)];
    const loaded = require(configPath);
    const config = typeof loaded === "function" ? loaded({}) : loaded;
    if (config && config.type && config.name) {
      out.push({ dir, name: config.name, type: config.type, config });
    }
  }
  return out;
}

module.exports = { readGeneratedTargets };
