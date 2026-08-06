import { defineConfig } from "vitest/config";

// Fail loud before any test runs (2026-08-06): plugin.test.ts and
// scaffold.test.ts require() typed .cts tooling and rely on the Node
// runtime's NATIVE type stripping (`node = "24"` in ../.mise.toml). A `pnpm`
// resolved from some other Node installation — the classic is an nvm dir
// ahead of mise on PATH, whose corepack shim then runs everything under that
// older Node; `mise exec -- pnpm test` does NOT help, mise only resolves the
// first command — fails exactly those two files with a cryptic
// "SyntaxError: Unexpected token" while the other 67 pass. Refuse to start
// with an instruction instead. (This config itself is transpiled by vitest,
// so the check runs even on a Node that can't parse TS.)
const stripping = (process.features as { typescript?: string | boolean })
  .typescript;
if (!stripping) {
  throw new Error(
    `vitest is running under Node ${process.version}, which has no native ` +
      "TypeScript type stripping (needed to require() the typed .cts " +
      "tooling). Run the suite under the mise-pinned Node 24:\n" +
      '  PATH="$(mise where node)/bin:$PATH" pnpm test\n' +
      'or activate mise in this shell first (eval "$(mise activate zsh)").',
  );
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
