import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type InvokeErrorCode, invoke } from "../src/invoke";
import { installMockHost } from "./helpers";

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.__host;
  delete g.__resolveInvoke;
  delete g.__rejectInvoke;
});

describe("invoke channel (SD-1)", () => {
  it("resolves a routed method's JSON result", async () => {
    installMockHost(); // mock routes saveUpdate -> { accepted: true }
    expect(await invoke("saveUpdate", { js: "x" })).toEqual({ accepted: true });
  });

  it("rejects an unrouted method with UNKNOWN_METHOD (never hangs)", async () => {
    installMockHost();
    await expect(invoke("nope")).rejects.toMatchObject({
      code: "UNKNOWN_METHOD",
    });
  });

  it("rejects with UNAVAILABLE when there is no invoke-capable host", async () => {
    await expect(invoke("saveUpdate")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  it("rejects a non-serializable payload with INVALID_REQUEST and never dispatches", async () => {
    // A circular ref (or BigInt) makes JSON.stringify throw. That must reject
    // cleanly BEFORE arming the pending entry + 30s timer, so nothing leaks and
    // native is never called (CX-022 no-leak).
    const host = installMockHost();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(invoke("saveUpdate", circular)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(host.invoke).not.toHaveBeenCalled();
  });

  it("surfaces a native POLICY_DENIED rejection as its typed code", async () => {
    // ARCH-07: the host rejects an invoke whose feature the app's HostPolicy
    // didn't authorize. The code is part of the closed InvokeErrorCode set —
    // the annotation below fails to COMPILE if it's dropped from the union.
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (g.__rejectInvoke as (i: number, j: string) => void)(
        id,
        JSON.stringify({
          code: "POLICY_DENIED",
          message:
            "method 'bleConnect' is blocked by this app's host policy — " +
            "requires an app configuration change",
        }),
      );
    });
    const denied: InvokeErrorCode = "POLICY_DENIED";
    await expect(invoke("bleConnect")).rejects.toMatchObject({
      code: denied,
      message: expect.stringContaining("app configuration change"),
    });
  });

  it("degrades an unrecognized native code to INTERNAL, keeping it in the message", async () => {
    // The closed set used to be closed by TYPE ONLY: settle() did
    // `parsed.code as InvokeErrorCode`, so a native code outside the union
    // landed in error.code and TypeScript endorsed it — no
    // `if (e.code === "UNAVAILABLE")` could ever match. That shipped twice
    // ("AUDIO_FAILED", then "LOCATION_UNAVAILABLE"). The Swift side is now an
    // enum; this is the runtime guard on the JS end, for an older binary or a
    // future drift.
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (g.__rejectInvoke as (i: number, j: string) => void)(
        id,
        JSON.stringify({
          code: "LOCATION_UNAVAILABLE",
          message: "current location unavailable",
        }),
      );
    });
    await expect(invoke("getCurrentLocation")).rejects.toMatchObject({
      code: "INTERNAL",
      // The original spelling survives in the message — the native bug stays
      // diagnosable instead of being erased by the degrade.
      message: "LOCATION_UNAVAILABLE: current location unavailable",
    });
  });

  it("does not treat an inherited Object key as a valid code", async () => {
    // The lookup indexes a Record, so "constructor"/"toString" (present on
    // every object's prototype chain) must NOT pass as members of the set.
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (g.__rejectInvoke as (i: number, j: string) => void)(
        id,
        JSON.stringify({ code: "constructor", message: "wat" }),
      );
    });
    await expect(invoke("getCurrentLocation")).rejects.toMatchObject({
      code: "INTERNAL",
      message: "constructor: wat",
    });
  });

  it("settles exactly once — a duplicate native reply is ignored", async () => {
    const host = installMockHost();
    let capturedId = 0;
    host.invoke.mockImplementation((id: number) => {
      capturedId = id;
      (g.__resolveInvoke as (i: number, j: string) => void)(id, '"first"');
    });
    expect(await invoke("requestNotificationPermission")).toBe("first");
    // A duplicate reply for the same id must be a no-op (already settled).
    expect(() =>
      (g.__resolveInvoke as (i: number, j: string) => void)(
        capturedId,
        '"second"',
      ),
    ).not.toThrow();
  });
});

describe("invoke timeout net (NF-01)", () => {
  it("rejects INTERNAL when native accepts the call but never replies", async () => {
    vi.useFakeTimers();
    try {
      const host = installMockHost();
      host.invoke.mockImplementation(() => {
        // Native accepted the invoke and then dropped it on the floor.
      });
      const promise = invoke("requestNotificationPermission");
      const assertion = expect(promise).rejects.toMatchObject({
        code: "INTERNAL",
        message: expect.stringContaining("no native reply"),
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("a settle before the deadline cancels the timeout", async () => {
    vi.useFakeTimers();
    try {
      const host = installMockHost();
      host.invoke.mockImplementation((id: number) => {
        (g.__resolveInvoke as (i: number, j: string) => void)(id, '"ok"');
      });
      await expect(invoke("requestNotificationPermission")).resolves.toBe("ok");
      // Advancing past the deadline must not surface a late rejection.
      await vi.advanceTimersByTimeAsync(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a custom timeoutMs overrides the default watchdog", async () => {
    // User-mediated ops (permission/purchase) block on a system sheet and pass a
    // longer bound, so they must NOT reject at the 30 s default — only at theirs.
    vi.useFakeTimers();
    try {
      const host = installMockHost();
      host.invoke.mockImplementation(() => {
        // Native accepted and is waiting on the user; no reply yet.
      });
      const promise = invoke(
        "purchase",
        { productId: "p" },
        {
          timeoutMs: 5 * 60_000,
        },
      );
      const assertion = expect(promise).rejects.toMatchObject({
        code: "INTERNAL",
        message: expect.stringContaining("300000ms"),
      });
      // Past the default deadline: still pending (a deliberating user isn't a hang).
      await vi.advanceTimersByTimeAsync(30_000);
      // Only its own longer deadline settles it.
      await vi.advanceTimersByTimeAsync(5 * 60_000 - 30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The closed code set spans two languages, and until now only ONE side was
 * machine-checked: SupportTests.swift compares `InvokeErrorCode.allCases`
 * against a literal Swift array, so a member added to the TS union alone (plus
 * the `INVOKE_ERROR_CODES` Record, which tsc forces) left every test green
 * while JS advertised a code no bridge can emit — any
 * `if (e.code === "NEW_CODE")` a consumer writes is then silently dead. This
 * closes the TS -> Swift direction, the way codegen.test.ts pins
 * HostInvokeFeatures against the schema.
 */
describe("InvokeErrorCode is the same closed set in TS and Swift", () => {
  /** `INVOKE_ERROR_CODES` is `Record<InvokeErrorCode, true>`, so tsc already
   *  forces its keys to be exactly the union — reading them from source is a
   *  faithful image of the union without widening the public API. */
  function tsCodes(): string[] {
    const src = readFileSync(join(__dirname, "..", "src", "invoke.ts"), "utf8");
    const start = src.indexOf("const INVOKE_ERROR_CODES");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("};", start));
    return [...block.matchAll(/(\w+): true/g)]
      .map((m) => m[1] as string)
      .sort();
  }

  function swiftCodes(): string[] {
    const src = readFileSync(
      join(
        __dirname,
        "..",
        "swift",
        "Sources",
        "ReactWatchSupport",
        "InvokeErrorJSON.swift",
      ),
      "utf8",
    );
    const start = src.indexOf("public enum InvokeErrorCode");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("\n}", start));
    return [...block.matchAll(/case\s+`?\w+`?\s*=\s*"(\w+)"/g)]
      .map((m) => m[1] as string)
      .sort();
  }

  it("neither side carries a code the other cannot", () => {
    const ts = tsCodes();
    expect(ts.length).toBeGreaterThan(0);
    expect(swiftCodes()).toEqual(ts);
  });
});
