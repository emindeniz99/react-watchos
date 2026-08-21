// Fixture for qbc-symbolication.test.ts — BUILT by that test, never imported
// by it. It is the far end of the chain the test proves: this .tsx is what a
// resolved production `.qbc` frame has to point back at.
//
// Why a real .tsx and not a .ts string written at test time: the whole claim
// under test is that a frame survives the REAL pipeline (JSX transform ->
// bundle -> minify -> QuickJS bytecode), and a source map only earns trust if
// the file it names is one you can open. The names below are deliberately
// long and unique so an assertion on them cannot pass by coincidence, and so
// minification has something to visibly rename.
//
// Keep the throw on ONE line and do not reformat this file casually: the test
// locates `THROW_MARKER` by scanning the source for it, so the assertion moves
// with the code — but the two functions must stay separate (an inlined helper
// collapses the two frames the test wants to see).
import { Text, VStack } from "../../src/index";

/** Unique marker the test greps for to learn this file's real throw line. */
export function qbcSymbolicationInnerThrow(detail: string): never {
  throw new Error(`qbc-symbolication fixture: ${detail}`); // THROW_MARKER
}

/**
 * A component-shaped caller, so the resolved stack has a second frame above
 * the throw and the test can prove more than one position maps back.
 */
export function QbcSymbolicationFixtureScreen(props: { detail: string }) {
  // Guarded so the JSX below stays reachable for tsc (`allowUnreachableCode`
  // is off); `detail` is a plain string, so nothing narrows this to always-throw.
  if (props.detail !== "") qbcSymbolicationInnerThrow(props.detail);
  return (
    <VStack>
      <Text>unreachable</Text>
    </VStack>
  );
}

// Module scope on purpose: the bundle throws while JS_EvalFunction runs it, so
// the runner needs no host bridge and no event dispatch to produce the stack.
QbcSymbolicationFixtureScreen({ detail: "thrown from bytecode" });
