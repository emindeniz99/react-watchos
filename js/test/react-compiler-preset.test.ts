import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { watchBuildOptions } from "../esbuild/preset.mts";

// NF-28: the React Compiler ships as a preset flag, so installed consumers
// get the auto-memoization the README advertises (it used to be wired only
// into the repo's own demo build). The fixture is a component the compiler
// provably memoizes; its `react/compiler-runtime` cache import is the marker.
const FIXTURE = `
import { useState } from "react";
import { Button, Text, VStack } from "../../src/index";

export function Memoized({ label }: { label: string }) {
  const [n, setN] = useState(0);
  const heavy = label.toUpperCase();
  return (
    <VStack spacing={4}>
      <Text>{heavy}</Text>
      <Button onPress={() => setN(n + 1)}>
        <Text>{n}</Text>
      </Button>
    </VStack>
  );
}
`;

async function bundleWith(reactCompiler: boolean): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "rc-preset-"));
  const entry = join(dir, "entry.tsx");
  writeFileSync(
    entry,
    FIXTURE.split("../../src/index").join(join(__dirname, "../src/index")),
  );
  const outfile = join(dir, "bundle.js");
  await build(
    watchBuildOptions({
      entry,
      outfile,
      reactCompiler,
      // The fixture lives in a temp dir, outside any node_modules scope.
      nodePaths: [join(__dirname, "../node_modules")],
    }) as Parameters<typeof build>[0],
  );
  return readFileSync(outfile, "utf8");
}

describe("react compiler preset flag (NF-28)", () => {
  it("memoizes components when reactCompiler is enabled", async () => {
    const out = await bundleWith(true);
    expect(out).toContain("compiler-runtime");
  });

  it("leaves the bundle untouched when disabled (default)", async () => {
    const out = await bundleWith(false);
    expect(out).not.toContain("compiler-runtime");
  });
});
