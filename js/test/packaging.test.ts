import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the packaging contract: every path the published package promises
// (exports targets, the `files` whitelist) must exist AND be committed to
// git. The `build/` esbuild preset was once present on disk but gitignored,
// so `exports["./build"]` and the renderer's own build broke on a fresh
// clone — present-on-disk hid it, git-tracked catches it.

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
      expect(
        existsSync(join(jsRoot, target)),
        `${target} missing on disk`,
      ).toBe(true);
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
      // Directories: assert at least one tracked file under them.
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
