import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the packaging contract:
//   - every path the package promises (exports targets, `files`) must EXIST;
//   - source paths must be git-tracked (the `build/` esbuild preset was once
//     present on disk but gitignored, so the export broke on a fresh clone —
//     present-on-disk hid it, git-tracked catches it);
//   - built paths (lib/, produced by `prepare`/`build:lib`) are gitignored, so
//     they're checked for existence only — `pnpm install` rebuilds them.

const jsRoot = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(jsRoot, "package.json"), "utf8")) as {
  main: string;
  types: string;
  exports: unknown;
  files: string[];
};

// Build output, not committed (gitignored). Existence is required, not tracking.
const isBuilt = (relPath: string): boolean =>
  relPath.startsWith("./lib/") ||
  relPath.startsWith("lib/") ||
  relPath === "lib";

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
  it("every exports target exists (run prepare/build:lib first)", () => {
    for (const target of exportTargets()) {
      expect(existsSync(join(jsRoot, target)), `${target} missing`).toBe(true);
    }
  });

  it("source exports targets are git-tracked", () => {
    for (const target of exportTargets()) {
      if (isBuilt(target)) continue; // lib/ is built, not committed
      expect(isTracked(target), `${target} is not tracked by git`).toBe(true);
    }
  });

  it("main and types resolve to existing files", () => {
    for (const field of [pkg.main, pkg.types]) {
      expect(existsSync(join(jsRoot, field)), `${field} missing`).toBe(true);
    }
  });

  it("every `files` entry has files (source tracked, built present)", () => {
    for (const entry of pkg.files) {
      if (isBuilt(entry)) {
        expect(
          existsSync(join(jsRoot, entry)),
          `built "${entry}" missing`,
        ).toBe(true);
        continue;
      }
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
