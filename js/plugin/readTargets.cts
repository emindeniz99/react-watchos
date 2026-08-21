const fs = require("node:fs");
const path = require("node:path");

// Reads back the apple-targets config files the plugin generated under
// targets/<dir>/expo-target.config.js. Shared by the post-prebuild scripts so
// they discover the resolved target names / types / infoPlist without
// re-parsing the Expo config (the generated files are the resolved truth).

export interface GeneratedTarget {
  dir: string;
  name: string;
  type: string;
  // This is the consumer's own expo-target.config.js, `require`d back at
  // runtime — an arbitrary user-authored object. Only `type`/`name`/`infoPlist`
  // are ever read and each read narrows, so `unknown` would only move the cast.
  // biome-ignore lint/suspicious/noExplicitAny: user-authored config object — see above
  config: Record<string, any>;
}

function readGeneratedTargets(projectRoot: string): GeneratedTarget[] {
  const targetsDir = path.join(projectRoot, "targets");
  if (!fs.existsSync(targetsDir)) return [];
  const out: GeneratedTarget[] = [];
  for (const dir of fs.readdirSync(targetsDir)) {
    const configPath = path.join(targetsDir, dir, "expo-target.config.js");
    if (!fs.existsSync(configPath)) continue;
    // The generated files are plain `module.exports = <object>`; a consumer's
    // hand-authored file may still be a function — handle both.
    delete require.cache[require.resolve(configPath)];
    const loaded = require(configPath);
    const config = typeof loaded === "function" ? loaded({}) : loaded;
    if (config?.type && config?.name) {
      out.push({ dir, name: config.name, type: config.type, config });
    }
  }
  return out;
}

module.exports = { readGeneratedTargets };
