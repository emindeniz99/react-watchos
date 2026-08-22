import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash } from "../esbuild/manifest.mts";
import { buildTool, qjsAvailable, requireQjs } from "./qjs-tools";

/**
 * The `.qbc` content hash (FNV-1a 64-bit, lowercase hex, no leading zeros)
 * exists three times, and every pair of them is a trust boundary:
 *
 *   tools/qjs-compile/qjs-compile.c `fnv1a`   stamps `[out.hash]` beside the
 *                                             shipped bundle.qbc at build time
 *   ReactWatchSupport.ContentHash             is what loadShipped compares that
 *                                             stamp against (OP-1), and what
 *                                             the host publishes as
 *                                             `__bundleReleaseId`
 *   js/esbuild/manifest.mts `contentHash`     stamps the OTA manifest's
 *                                             `releaseId` (CX-025)
 *
 * A silent drift in ANY of the three doesn't error anywhere — it presents as
 * "every boot falls back to parsing source" (the stamp never matches) or
 * "every check reports an update" (releaseId never matches). This suite and
 * its Swift twin (ContentHashParityVectorTests) assert ONE shared vector file
 * — js/swift/Tests/ReactWatchTests/Fixtures/content-hash-vectors.json — from
 * all three implementations, so a drift fails a test instead of a fleet.
 *
 * The vector file is STATIC and hand-authored. Never regenerate it from one
 * of the implementations: that would rewrite the expectation with exactly the
 * drift it exists to catch.
 */

interface Vector {
  name: string;
  input: string;
  hash: string;
}

const vectorsPath = join(
  __dirname,
  "../swift/Tests/ReactWatchTests/Fixtures/content-hash-vectors.json",
);
const { vectors } = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
  vectors: Vector[];
};

describe("content-hash vector file", () => {
  it("still covers the shapes that catch drift", () => {
    // Guards the FILE, so a careless edit can't hollow the gate: the empty
    // input (pins the offset basis alone), a 1-byte input, a multi-KB input
    // dense in bytes >= 0x80 (multi-byte UTF-8 — where a signed-byte or
    // codepoint-vs-byte mistake shows up), and a hash shorter than 16
    // nibbles (pins the no-leading-zeros hex formatting as load-bearing).
    const byteLength = (v: Vector) => Buffer.byteLength(v.input, "utf8");
    expect(vectors.some((v) => v.input === "")).toBe(true);
    expect(vectors.some((v) => byteLength(v) === 1)).toBe(true);
    expect(
      vectors.some(
        (v) =>
          byteLength(v) > 2048 &&
          Buffer.from(v.input, "utf8").some((b) => b >= 0x80),
      ),
    ).toBe(true);
    expect(vectors.some((v) => v.hash.length < 16)).toBe(true);
    // Every expected hash is already in the canonical format, so an
    // implementation echoing e.g. uppercase could never "match by luck".
    for (const v of vectors) {
      expect(v.hash).toMatch(/^(?!0)[0-9a-f]{1,16}$/);
    }
  });
});

describe("content-hash parity: Node builder (manifest releaseId)", () => {
  it("reproduces every shared vector", () => {
    for (const v of vectors) {
      expect(`${v.name}: ${contentHash(v.input)}`).toBe(`${v.name}: ${v.hash}`);
    }
  });
});

// The C side is asserted through the REAL production path — qjs-compile's
// optional [out.hash] argument, the stamp loadShipped pairs bundle.qbc to —
// built the same way qbc-symbolication.test.ts builds it: the actual tool
// linked against the vendored-engine object cache. Every vector input is
// deliberately a valid JS program (comments carry the high bytes) so the
// compile step succeeds and no hash-only harness mode has to exist.
describe.skipIf(!qjsAvailable && !requireQjs)(
  "content-hash parity: C tool (qjs-compile [out.hash])",
  () => {
    it("stamps the same hash for every shared vector", () => {
      // Reached with no compiler only under REQUIRE_QJS=1 (otherwise the
      // suite is skipped above) — fail with a message that names the fix.
      if (!qjsAvailable) {
        throw new Error(
          "REQUIRE_QJS=1 is set but the vendored quickjs-ng could not be " +
            "built. tools/vendored-qjs/build.sh needs a C compiler (cc). " +
            "This suite is the C third of the content-hash parity gate and " +
            "must not be skipped in CI.",
        );
      }
      const dir = mkdtempSync(join(tmpdir(), "content-hash-parity-"));
      const tool = buildTool("qjs-compile");
      for (const v of vectors) {
        const input = join(dir, `${v.name}.js`);
        writeFileSync(input, v.input);
        execFileSync(
          tool,
          [input, join(dir, `${v.name}.qbc`), join(dir, `${v.name}.hash`)],
          { stdio: "pipe" },
        );
        const stamped = readFileSync(join(dir, `${v.name}.hash`), "utf8");
        expect(`${v.name}: ${stamped}`).toBe(`${v.name}: ${v.hash}`);
      }
    }, 180_000);
  },
);
