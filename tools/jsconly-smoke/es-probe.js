// EXPERIMENT (see README.md) — the language-level half of the comparison,
// ported unchanged from the PrimJS experiment
// (`git show origin/experiment/primjs-engine:tools/primjs-smoke/es-probe.js`)
// so the two evaluations report the same 30 rows and their scores can be read
// side by side. Only this header differs.
//
// This repo's esbuild preset emits `target: "es2020"` (js/esbuild/preset.mts),
// so a bundle is allowed to contain constructs a full spec year past what an
// engine advertises. The production bundle booting proves the features it
// HAPPENS to use are present; it says nothing about the ones a consumer's app
// may use tomorrow. JSC is the engine that ships in Safari, so the expectation
// here is a near-perfect score — the point of running it is to confirm that,
// and to see which host-provided globals (Intl, TextEncoder, structuredClone)
// a bare JSCOnly context does and does not carry.
//
// Every check is a SOURCE STRING run through eval inside try/catch, not a
// closure. That is deliberate and was learned the hard way: written as
// closures, one unsupported *syntax* is a parse error for the whole file, and
// the run dies at line 1 reporting nothing. As strings, a missing operator is
// one MISSING row like any other and the other answers still come back. A
// probe that can only report "everything" or "nothing" is not a probe.
//
// Run with either shell:
//   "$(sh ../vendored-qjs/build.sh)"          es-probe.js   # quickjs-ng
//   "$(sh fetch-and-build.sh --jsc)"          es-probe.js   # JSCOnly, jitless
const checks = [
  // ES2020 — the floor this repo's own bundles are compiled to.
  ["es2020 optional chaining", '({a:{b:1}})?.a?.b === 1'],
  ["es2020 nullish coalescing", '(null ?? 7) === 7'],
  ["es2020 BigInt", 'typeof 10n === "bigint"'],
  ["es2020 globalThis", 'typeof globalThis === "object"'],
  ["es2020 String.matchAll", '[..."aa".matchAll(/a/g)].length === 2'],
  ["es2020 Promise.allSettled", 'typeof Promise.allSettled === "function"'],
  ["es2020 object spread", 'JSON.stringify({...{a:1}}) === \'{"a":1}\''],
  // ES2021+ — past both engines' stated floor, but esbuild emits them verbatim
  // when the source uses them, because the preset's target permits it.
  ["es2021 logical assignment", 'let x = null; x ??= 3; return x === 3'],
  ["es2021 String.replaceAll", '"aa".replaceAll("a","b") === "bb"'],
  ["es2021 WeakRef", 'typeof WeakRef === "function"'],
  ["es2021 numeric separators", '1_000 === 1000'],
  ["es2022 Object.hasOwn", 'typeof Object.hasOwn === "function"'],
  ["es2022 Array.at", '[1,2,3].at(-1) === 3'],
  ["es2022 class fields", 'class C { x = 1 } return new C().x === 1'],
  ["es2022 private fields", 'class C { #x = 1; g(){return this.#x} } return new C().g() === 1'],
  ["es2022 class static block", 'class C { static { } } return true'],
  ["es2022 error cause", 'new Error("x",{cause:1}).cause === 1'],
  ["es2022 regexp /d indices", '/a/d.exec("a").indices !== undefined'],
  ["es2022 top-level await(mod)", 'typeof (async () => await 1) === "function"'],
  ["es2023 Array.findLast", '[1,2].findLast((v) => v === 1) === 1'],
  ["es2023 Array.toSorted", 'typeof [].toSorted === "function"'],
  ["es2024 Object.groupBy", 'typeof Object.groupBy === "function"'],
  ["es2024 Promise.withResolvers", 'typeof Promise.withResolvers === "function"'],
  // Things this project's runtime layer leans on directly.
  ["Proxy", 'typeof Proxy === "function"'],
  ["Reflect.ownKeys", 'typeof Reflect.ownKeys === "function"'],
  ["Symbol.asyncIterator", 'typeof Symbol.asyncIterator === "symbol"'],
  ["async generators", 'typeof (async function* (){}) === "function"'],
  ["structuredClone", 'typeof structuredClone === "function"'],
  ["TextEncoder", 'typeof TextEncoder === "function"'],
  ["Intl", 'typeof Intl === "object"'],
];

let missing = 0;
for (const [name, src] of checks) {
  let ok = false;
  try {
    // Indirect eval: global scope, so a `let` in one check cannot leak into the
    // next and turn an unrelated row red.
    const body = src.startsWith("class ") || src.startsWith("let ")
      ? src
      : `return ${src}`;
    ok = (0, eval)(`(() => { ${body} })()`) === true;
  } catch (e) {
    ok = false;
  }
  if (!ok) missing++;
  print(`${ok ? "ok     " : "MISSING"}  ${name}`);
}
print(`-- ${checks.length - missing}/${checks.length} present`);
