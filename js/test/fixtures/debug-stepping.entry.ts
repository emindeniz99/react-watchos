// Fixture for test/dap-debugger.test.ts. THE LINE NUMBERS BELOW ARE ASSERTED —
// the test sets a breakpoint on line 12 and expects specific frames back, so
// adding or removing a line here means updating the expectations there. The
// shape is deliberate: a call inside a loop, so `next`, `stepIn` and `stepOut`
// each land somewhere different and a wrong one cannot masquerade as a right
// one.
//
// Plain .ts, no JSX and no renderer import: this fixture exists to prove the
// debugger's control flow, and dragging React into it would only make the
// instrumented bundle slower to build and the assertions harder to read.

export function add(a: number, b: number): number {
  const sum = a + b;
  return sum;
}

function run(times: number): number {
  let total = 0;
  for (let index = 0; index < times; index++) {
    total = add(total, index);
  }
  return total;
}

const result = run(3);
(globalThis as { __result?: number }).__result = result;
