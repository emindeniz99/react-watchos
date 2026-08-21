// EXPERIMENT (see README.md) — the smallest reproduction of this experiment's
// headline finding: PrimJS's `??` falls through on `undefined` but NOT on
// `null`, which ES2020 §13.15 requires. It does not throw and it does not warn;
// it returns the wrong value.
//
// Every case is a RUNTIME null reached a different way — variable, function
// return, property, array element, nested — because the first thing to rule out
// is a constant-folding bug in the parser, which would be far less serious than
// a bug in the operator. All five are wrong on PrimJS, so it is the operator.
//
// Run with either CLI built by build-hosts.sh:
//   ./out/qjs-qjsng  nullish-probe.js    -> every line prints FB   (correct)
//   ./out/qjs-primjs nullish-probe.js    -> every line prints null (WRONG)
//
// Root cause, visible in source and not in any build flag:
//   quickjs-ng quickjs.c:28170   emit_op(s, OP_is_undefined_or_null);
//   PrimJS     quickjs.cc:22356  emit_op(s, OP_is_undefined);
// PrimJS has no OP_is_undefined_or_null opcode at all.

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

// The control: `undefined` DOES fall through on both engines, which is why the
// production bundle boots green on PrimJS — the demo path happens to hit
// undefined operands, where PrimJS is accidentally correct.
print("undefined ctl", undefined ?? "FB");
print("missing prop ", {}.nope ?? "FB");

// `?.` is fine on both — so the bug is specific to `??`, not to nullish
// handling in general.
print("optchain ctl ", null?.x === undefined ? "FB" : "WRONG");
