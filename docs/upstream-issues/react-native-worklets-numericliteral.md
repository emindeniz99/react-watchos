# Upstream issue draft: react-native-worklets `numericLiteral(-27)`

**Status: DRAFT — not yet filed.** Everything below the horizontal rule is the
proposed issue body, ready to paste.

**Where to file:** <https://github.com/software-mansion/react-native-reanimated>
— the `software-mansion/react-native-worklets` repository is a redirect: its
README says the code lives in the Reanimated monorepo
(`packages/react-native-worklets`) and asks for issues to be opened there.

**Provenance of every claim** (verified 2026-08-22 on this repo's toolchain,
Node 22.22.2, Linux):

- The call site was confirmed by unpacking the published npm tarballs of
  `react-native-worklets` **0.12.1** (`latest`) and
  **0.13.0-nightly-20260821-993c65e83** (`nightly`): both contain
  `numericLiteral(-27)` at `plugin/index.js:1928` (bundled module
  `lib/workletFactory.js`, function `makeWorkletFactory`).
- The accept/reject matrix was measured by calling `t.numericLiteral(-27)`
  directly against published `@babel/types` builds: 7.27.1, 7.28.0 and 7.29.7
  return a node silently (their compiled builder contains the "non-negative"
  validation *text* but the throw is compiled out of Babel 7 publishes);
  **8.0.0 throws**.
- The end-to-end failure and the one-line fix were both reproduced with the
  exact setup in the repro section.
- One gap, flagged rather than papered over: the pnpm patch we reference as the
  workaround lives in a downstream consumer app repo (FlareLog), not in this
  repository, so its exact patch file is not reproduced here. The equivalent
  one-line change was re-verified locally (see "Suggested fix").

---

## Title

`[worklets babel plugin] makeWorkletFactory builds numericLiteral(-27) — invalid AST that @babel/types 8 rejects, crashing every worklet transform on a Babel 8 toolchain`

## Environment

- `react-native-worklets` 0.12.1 (npm `latest`) — also present unchanged in
  0.13.0-nightly-20260821-993c65e83 (npm `nightly`)
- `@babel/core` 8.0.1 with `@babel/types` 8.0.0 resolved for the plugin
  (see "When it bites" for how that resolution happens)
- Node 22.22.2, Linux (the failure is platform-independent — it is a pure
  Babel transform crash)

## What happens

`makeWorkletFactory` (published bundle: `plugin/index.js` line 1928, module
`lib/workletFactory.js`) injects the dev-mode `__stackDetails` tuple:

```js
statements.unshift(variableDeclaration("const", [
  variableDeclarator(identifier("_e"), arrayExpression([
    newExpression(memberExpression(identifier("global"), identifier("Error")), []),
    numericLiteral(lineOffset),
    numericLiteral(-27)
    // the placement of opening bracket after Exception in line that defined '_e' variable
  ]))
]));
```

`numericLiteral(-27)` is not a valid Babel AST node: a `NumericLiteral`'s value
must be a non-negative finite number (a negative number is
`UnaryExpression("-", NumericLiteral)`). `@babel/types` has carried exactly
this validation for years, but every Babel **7**.x publish compiles the throw
out of the builder, so the invalid node is produced silently. Babel **8**
publishes keep the throw:

```
NumericLiterals must be non-negative finite numbers. You can use t.valueToNode(-27) instead.
```

So on a toolchain where the plugin's `require("@babel/types")` resolves to 8.x,
**every file containing a worklet fails to transform** (the injection runs for
every worklet in non-release, non-`bundleMode` builds).

## When it bites

The plugin declares `"@babel/types": "^7.27.1"` as its own dependency, so a
fully isolated install is not affected today. It crashes as soon as the
plugin's `@babel/types` resolves to 8.x instead — e.g. an app already on
`@babel/core` 8 whose package manager hoists/dedupes a single `@babel/types`,
or a workspace that forces `@babel/*` to v8 via `overrides` /
`pnpm.overrides`. Concretely: this is broken **today** for Babel 8 consumers,
and a guaranteed breakage for the plugin's own eventual Babel 8 support.

## Minimal repro

`package.json` (npm `overrides` stand in for any resolution that gives the
plugin Babel 8, e.g. hoisting in a Babel 8 app):

```json
{
  "name": "worklets-babel8-repro",
  "private": true,
  "dependencies": {
    "@babel/core": "8.0.1",
    "react-native-worklets": "0.12.1"
  },
  "overrides": {
    "@babel/types": "8.0.0",
    "@babel/traverse": "8.0.0",
    "@babel/generator": "8.0.0",
    "@babel/preset-typescript": "8.0.1",
    "@babel/plugin-transform-arrow-functions": "8.0.0",
    "@babel/plugin-transform-class-properties": "8.0.0",
    "@babel/plugin-transform-classes": "8.0.0",
    "@babel/plugin-transform-nullish-coalescing-operator": "8.0.0",
    "@babel/plugin-transform-optional-chaining": "8.0.0",
    "@babel/plugin-transform-shorthand-properties": "8.0.0",
    "@babel/plugin-transform-template-literals": "8.0.0",
    "@babel/plugin-transform-unicode-regex": "8.0.0"
  }
}
```

`input.js`:

```js
function styleFactory() {
  "worklet";
  return { opacity: 1 };
}
export default styleFactory;
```

Run:

```js
// node run.js
const { transformFileSync } = require("@babel/core");
transformFileSync(require.resolve("./input.js"), {
  plugins: ["react-native-worklets/plugin"],
  configFile: false,
  babelrc: false,
});
```

## Actual result

```
Error: input.js: [Worklets] Babel plugin exception: NumericLiterals must be non-negative finite numbers. You can use t.valueToNode(-27) instead.
    at numericLiteral (node_modules/@babel/types/lib/index.js:6253:3)
    at makeWorkletFactory (node_modules/react-native-worklets/plugin/index.js:1928:41)
    at makeWorkletFactoryCall (node_modules/react-native-worklets/plugin/index.js:2043:102)
    at processWorklet (node_modules/react-native-worklets/plugin/index.js:2099:82)
```

## Expected result

The transform succeeds and emits the dev-mode stack details:

```js
const _e = [new global.Error(), 1, -27];
styleFactory.__stackDetails = _e;
```

## Suggested fix

One line: build the negative constant the way Babel itself suggests —

```diff
-            numericLiteral(-27)
+            valueToNode(-27)
```

`valueToNode(-27)` produces `UnaryExpression("-", NumericLiteral(27))`, which
generates the identical `-27` in the output. Verified against the repro above:
after patching exactly that call in `plugin/index.js`, the same transform
succeeds and emits `const _e = [new global.Error(), 1, -27];`. (It also stays
valid on Babel 7, so no version gate is needed.)

## Workaround we carry meanwhile

A consumer-side pnpm patch (`pnpm patch react-native-worklets`) that applies
the one-line replacement above to `plugin/index.js`.
