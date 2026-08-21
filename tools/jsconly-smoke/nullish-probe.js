// EXPERIMENT (see README.md) — the CONTROL GROUP, ported from the PrimJS
// experiment (`git show
// origin/experiment/primjs-engine:tools/primjs-smoke/nullish-probe.js`).
//
// It exists here for one reason: the PrimJS evaluation was decided by this
// file. PrimJS's `??` falls through on `undefined` but NOT on `null`, which
// ES2020 §13.15 requires — a wrong-answer bug in a core operator, with 47 live
// `??` sites in this repo's own production bundle. Running the identical probe
// against JavaScriptCore is what makes "JSC is correct here" a MEASUREMENT
// rather than an assumption about a browser engine. If a probe only ever runs
// against the engine you expect to fail it, it is not a probe, it is a
// prosecution.
//
// Every case is a RUNTIME null reached a different way — variable, function
// return, property, array element, nested — because the first thing to rule out
// is a constant-folding bug in the parser, which would be far less serious than
// a bug in the operator.
//
// Run with either shell; every line must print FB:
//   "$(sh ../vendored-qjs/build.sh)"  nullish-probe.js
//   "$(sh fetch-and-build.sh --jsc)"  nullish-probe.js

var n = null;
print("literal      ", null ?? "FB");
print("variable     ", n ?? "FB");

function f() {
  return null;
}
print("call result  ", f() ?? "FB");

var o = { p: null };
print("property     ", o.p ?? "FB");

var a = [null];
print("array element", a[0] ?? "FB");

print("nested       ", (n ?? undefined) ?? "FB");

// The control's control: `undefined` falls through everywhere.
print("undefined ctl", undefined ?? "FB");
print("missing prop ", {}.nope ?? "FB");

// `?.` is fine everywhere — so a failure above would be specific to `??`.
print("optchain ctl ", null?.x === undefined ? "FB" : "WRONG");
