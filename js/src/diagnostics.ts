import { registerNativeListener, type Unsubscribe } from "./nativeEvents";

/**
 * Structured host diagnostics (ARCH-13). Native reports every host-side
 * error/notice as a `Diagnostic` record — recorded in an always-on native
 * ring (last 50, release builds too) — and forwards each one into JS as a
 * `diagnostic` native event, EXCEPT `js`-subsystem records: those originated
 * in JS (an onError report), and pushing them back in would let a listener
 * that throws feed the next error — an echo loop.
 *
 * Mirrors ReactWatchSupport's `Diagnostic` (Swift); keep the two in sync.
 */
// TODO(codegen): fold into codegen/schema.ts when the toolchain is available,
// so this type and the Swift record can't drift.
export type DiagnosticSeverity = "fatal" | "recoverable" | "info";

export type DiagnosticSubsystem =
  | "boot"
  | "ota"
  | "wire"
  | "commit"
  | "js"
  | "capability"
  | "budget"
  | "connectivity";

export interface Diagnostic {
  /** Stable machine code, dot-namespaced by subsystem (e.g. "ota.saveRejected"). */
  code: string;
  severity: DiagnosticSeverity;
  subsystem: DiagnosticSubsystem;
  /** Fresh UUID per native boot — correlates one JS generation's records. */
  sessionId: string;
  /** Content hash of the booted bundle (CX-025); absent before load. */
  releaseId?: string;
  target: "watch" | "widget";
  /** Epoch milliseconds. */
  timestamp: number;
  /** What the user can do about it. Reserved — absent in v1. */
  userAction?: string;
  /** Human-readable message. */
  details?: string;
}

export const DIAGNOSTIC_EVENT = "diagnostic";

/**
 * Subscribes `handler` to host diagnostics — e.g. to forward OTA rollback or
 * budget-breach records to an app's own telemetry. Returns an unsubscribe
 * function; use it as a React effect's cleanup.
 */
export function onDiagnostic(
  handler: (diagnostic: Diagnostic) => void,
): Unsubscribe {
  return registerNativeListener(DIAGNOSTIC_EVENT, (payload) => {
    handler(payload as unknown as Diagnostic);
  });
}
