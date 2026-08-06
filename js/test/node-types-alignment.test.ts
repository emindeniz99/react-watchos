import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @types/node must describe the Node this workspace actually RUNS — the
// .mise.toml pin — never a newer major. Types above the runtime make tsc
// approve APIs that do not exist here (a Node-26-only call typechecks, then
// crashes on the pinned Node 24), which inverts the whole point of the types.
// It happened once: 2026-07-29 took @types/node 26 "across the workspace"
// while the runtime pin stayed 24, and nothing complained until a human did
// (2026-08-06). Bump @types/node and the .mise.toml pin TOGETHER, or not at
// all. (The shipped plugin/*.cts additionally supports consumers on Node
// >= 22.18 — engines in js/package.json — so avoid post-22.18 APIs there
// regardless of what the dev types allow; that half stays a review concern,
// a type roster can't express "the floor is lower than the dev runtime".)
const root = join(__dirname, "..", "..");

function miseNodeMajor(): number {
  const mise = readFileSync(join(root, ".mise.toml"), "utf8");
  const match = mise.match(/^node\s*=\s*"(\d+)/m);
  if (!match)
    throw new Error(".mise.toml no longer pins node — update this test");
  return Number(match[1]);
}

const MEMBERS = [
  "js/package.json",
  "examples/expo-watch-app/package.json",
  "examples/minimal-watch-app/package.json",
];

describe("@types/node tracks the mise-pinned Node runtime", () => {
  const runtimeMajor = miseNodeMajor();

  for (const member of MEMBERS) {
    it(`${member} pins @types/node@${runtimeMajor}.x`, () => {
      const pkg = JSON.parse(readFileSync(join(root, member), "utf8"));
      const range: string | undefined = pkg.devDependencies?.["@types/node"];
      if (range === undefined) return; // a member may simply not need it
      const major = Number(range.match(/(\d+)/)?.[1]);
      expect(
        major,
        `${member} declares @types/node "${range}" but .mise.toml runs Node ${runtimeMajor} — ` +
          "types newer than the runtime let tsc approve APIs that crash here; " +
          "bump the mise pin and the types major together",
      ).toBe(runtimeMajor);
    });
  }
});
