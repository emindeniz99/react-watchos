import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTIC_EVENT,
  type Diagnostic,
  dispatchNativeEvent,
  inspectorSnapshot,
  onDiagnostic,
  startInspector,
  stopInspector,
} from "../src/index";

// Native pushes each host diagnostic (minus the js subsystem — echo-loop
// protection) as a `diagnostic` native event; these tests drive that channel
// through dispatchNativeEvent exactly as __pushNativeEvent would.
function makeDiagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: "ota.saveRejected",
    severity: "recoverable",
    subsystem: "ota",
    sessionId: "session-1",
    target: "watch",
    timestamp: 1_700_000_000_000,
    details: "signature invalid",
    ...overrides,
  };
}

afterEach(() => {
  stopInspector();
});

describe("onDiagnostic", () => {
  it("delivers host diagnostics and unsubscribes cleanly", () => {
    const seen: Diagnostic[] = [];
    const unsubscribe = onDiagnostic((d) => seen.push(d));

    const diagnostic = makeDiagnostic();
    expect(
      dispatchNativeEvent(
        DIAGNOSTIC_EVENT,
        diagnostic as unknown as Record<string, unknown>,
      ),
    ).toBe(true);
    expect(seen).toEqual([diagnostic]);

    unsubscribe();
    dispatchNativeEvent(
      DIAGNOSTIC_EVENT,
      makeDiagnostic({ code: "ota.checkFailed" }) as unknown as Record<
        string,
        unknown
      >,
    );
    expect(seen).toHaveLength(1);
  });

  it("fans out to multiple subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onDiagnostic(a);
    const offB = onDiagnostic(b);
    dispatchNativeEvent(
      DIAGNOSTIC_EVENT,
      makeDiagnostic() as unknown as Record<string, unknown>,
    );
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });
});

describe("inspector diagnostics exposure", () => {
  it("buffers diagnostics into the snapshot once started, capped at 50", () => {
    // Before the inspector ever starts, nothing is tapped.
    expect(inspectorSnapshot().diagnostics).toEqual([]);

    // A huge interval + an unroutable URL: no tick fires during the test and
    // the exposure stays purely in-memory.
    const stop = startInspector({
      url: "http://127.0.0.1:9/snapshot",
      intervalMs: 3_600_000,
    });
    try {
      for (let n = 1; n <= 55; n += 1) {
        dispatchNativeEvent(
          DIAGNOSTIC_EVENT,
          makeDiagnostic({ code: `budget.maxNodes.${n}` }) as unknown as Record<
            string,
            unknown
          >,
        );
      }
      const snap = inspectorSnapshot().diagnostics;
      // Ring semantics: the oldest 5 fell off.
      expect(snap).toHaveLength(50);
      expect(snap[0]?.code).toBe("budget.maxNodes.6");
      expect(snap[49]?.code).toBe("budget.maxNodes.55");
    } finally {
      stop();
    }
  });
});
