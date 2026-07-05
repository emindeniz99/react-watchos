import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the packaging contract: every path the published package promises
// (exports targets, main/types, the `files` whitelist) must exist AND be
// committed to git. The esbuild preset was once present on disk but gitignored,
// so its export broke on a fresh clone — present-on-disk hid it, git-tracked
// catches it. The package ships source (it's bundle-only), so there is no
// build step / built output to special-case.

const jsRoot = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(jsRoot, "package.json"), "utf8")) as {
  main: string;
  types: string;
  exports: unknown;
  files: string[];
};

function isTracked(relPath: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", relPath], {
      cwd: jsRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/** Every concrete file an exports conditions map points at. */
function exportTargets(): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      if (node.startsWith("./")) out.push(node);
    } else if (node && typeof node === "object") {
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(pkg.exports);
  return [...new Set(out)];
}

describe("packaging contract", () => {
  it("every exports target exists and is committed", () => {
    for (const target of exportTargets()) {
      expect(existsSync(join(jsRoot, target)), `${target} missing`).toBe(true);
      expect(isTracked(target), `${target} is not tracked by git`).toBe(true);
    }
  });

  it("main and types point at committed files", () => {
    for (const field of [pkg.main, pkg.types]) {
      expect(isTracked(field), `${field} is not tracked by git`).toBe(true);
    }
  });

  it("every `files` entry is committed", () => {
    for (const entry of pkg.files) {
      const tracked = execFileSync("git", ["ls-files", entry], {
        cwd: jsRoot,
        encoding: "utf8",
      }).trim();
      expect(tracked, `files entry "${entry}" has no committed files`).not.toBe(
        "",
      );
    }
  });
});

// DX-4: the published tarball must ship what a real `npm i` consumer needs to
// integrate — the SwiftPM host SOURCES (so the XCLocalSwiftPackageReference
// resolves from node_modules), the config plugin (incl. the in-prebuild wiring),
// and the CLI. `npm pack --dry-run` reports the exact file list npm would ship,
// catching a `files`/.npmignore mistake that "committed to git" alone wouldn't.
describe("published tarball contents (DX-4)", () => {
  const packedFiles = (): string[] => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: jsRoot,
      encoding: "utf8",
    });
    const report = JSON.parse(out) as Array<{
      files?: Array<{ path: string }>;
    }>;
    return (report[0]?.files ?? []).map((f) => f.path);
  };

  it("ships the Swift host sources, the plugin, and the CLI", () => {
    const files = packedFiles();
    for (const required of [
      "swift/Package.swift",
      "app.plugin.js",
      "plugin/index.cts",
      "plugin/withNativeWiring.cts",
      "plugin/scaffold.cts",
      "bin/react-watchos.cts",
      "esbuild/preset.mts",
    ]) {
      expect(files, `tarball is missing ${required}`).toContain(required);
    }
    // The SwiftPM ref resolves to <pkg>/swift, so the Sources must be in the
    // tarball (not just Package.swift) — at least the host module.
    const swiftSources = files.filter(
      (f) => f.startsWith("swift/Sources/") && f.endsWith(".swift"),
    );
    expect(swiftSources.length).toBeGreaterThan(0);
    expect(
      swiftSources.some((f) => f.includes("ReactWatchHost")),
      "tarball is missing the ReactWatchHost Swift sources",
    ).toBe(true);
  });

  it("does not ship build artifacts (.build) or tests-only noise", () => {
    const files = packedFiles();
    expect(files.some((f) => f.includes("swift/.build/"))).toBe(false);
  });
});
