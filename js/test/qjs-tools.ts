import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The shared "drive a real C tool against the real vendored engine" harness,
// extracted from qbc-symbolication.test.ts so content-hash-parity.test.ts
// exercises the SAME binaries the symbolication gate does instead of growing
// a second compile line to drift.

/** CI's switch: turn the no-C-compiler skip into a loud failure. */
export const requireQjs = process.env.REQUIRE_QJS === "1";
export const repoRoot = join(__dirname, "../..");
const vendorInclude = join(repoRoot, "js/swift/Sources/CQuickJS/include");

// The engine objects are built once by tools/vendored-qjs/build.sh and shared
// by every C tool in the repo (see its header) — the same warm cache
// qjs-smoke.test.ts relies on. A fresh clone with no C compiler is the one
// thing that legitimately cannot run this, and that (only that) skips the
// suites built on this helper; REQUIRE_QJS=1 turns the skip into a loud
// failure so CI can never silently drop those gates.
export const objDir = (() => {
  try {
    return execFileSync(
      join(repoRoot, "tools/vendored-qjs/build.sh"),
      ["--objdir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ).trim();
  } catch {
    return "";
  }
})();
export const qjsAvailable = objDir !== "";

/**
 * Compiles one of the repo's C tools against the prebuilt engine objects —
 * the same `cc` line tools/qjs-compile/run.sh uses — and caches the binary in
 * the OS tmpdir under a key covering everything that can change its output
 * (the C source, the engine objects, the compiler, the machine). Without the
 * cache every run of a suite using this would relink the whole engine; with
 * it a warm run costs nothing.
 */
export function buildTool(name: string): string {
  const source = join(repoRoot, "tools/qjs-compile", `${name}.c`);
  const objects = readdirSync(objDir)
    .filter((file) => file.endsWith(".o"))
    .sort()
    .map((file) => join(objDir, file));
  const cc = process.env.CC ?? "cc";
  const key = createHash("sha256");
  key.update(readFileSync(source));
  for (const object of objects) {
    const { size, mtimeMs } = statSync(object);
    key.update(`${object}:${size}:${mtimeMs}`);
  }
  key.update(`${cc}:${process.platform}:${process.arch}`);
  const binary = join(
    tmpdir(),
    `react-watchos-${name}-${key.digest("hex").slice(0, 16)}`,
  );
  if (!existsSync(binary)) {
    execFileSync(
      cc,
      [
        "-O2",
        "-std=gnu11",
        "-DNDEBUG",
        `-I${vendorInclude}`,
        "-o",
        binary,
        source,
        ...objects,
        "-lm",
        "-lpthread",
      ],
      { stdio: "pipe" },
    );
  }
  return binary;
}
