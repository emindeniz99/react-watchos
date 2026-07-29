/**
 * Operating budgets (ARCH-13) — tripwires, not ceilings, like every budget in
 * docs/budgets-and-limits.md: crossing one warns and the commit still
 * renders. THE constants module for the JS-side numbers; the native defaults
 * mirror these in ReactWatchSupport's BudgetPolicy.swift — keep the two in
 * sync until codegen can own both.
 */
export const BUDGETS = {
  /** Max live node instances in a committed tree (the renderer's instance
   *  map already knows the count; native never re-counts a decoded tree). */
  maxNodes: 1000,
  /** Max serialized commit payload. JS approximates bytes with string length
   *  (UTF-16 code units — an undercount for non-ASCII); native re-checks the
   *  true UTF-8 byte count for free on its decode path. */
  maxCommitJSONBytes: 262_144,
  /** Max wall-clock for one widget timeline render pass (checked natively —
   *  documented here so all four numbers live together). */
  maxWidgetRenderMs: 500,
  /** Soft cap on one `transferFile` payload, checked natively. OURS and
   *  provisional — Apple publishes no byte cap for `WCSession.transferFile`,
   *  only that it throttles for "performance and power concerns". Crossing it
   *  warns; the file still transfers, because `WCError` is the authority on
   *  what is actually too large. */
  maxTransferFileBytes: 1_048_576,
} as const;

/**
 * Per-root commit budget check with hysteresis: a budget that stays breached
 * warns once per CROSSING, re-arming only after the measurement drops back
 * under — a persistently-big tree at sensor-driven commit rates (10–20/sec)
 * must not warn on every commit. `warn` is injectable for tests; the
 * default is `console.warn`.
 */
export function createCommitBudgetCheck(
  warn: (message: string) => void = (message) => console.warn(message),
): (jsonLength: number, nodeCount: number) => void {
  let overBytes = false;
  let overNodes = false;
  return (jsonLength, nodeCount) => {
    if (jsonLength > BUDGETS.maxCommitJSONBytes) {
      if (!overBytes) {
        overBytes = true;
        warn(
          `commit JSON is ${jsonLength} chars — over the maxCommitJSONBytes ` +
            `budget (${BUDGETS.maxCommitJSONBytes})`,
        );
      }
    } else {
      overBytes = false;
    }
    if (nodeCount > BUDGETS.maxNodes) {
      if (!overNodes) {
        overNodes = true;
        warn(
          `tree has ${nodeCount} nodes — over the maxNodes budget ` +
            `(${BUDGETS.maxNodes})`,
        );
      }
    } else {
      overNodes = false;
    }
  };
}
