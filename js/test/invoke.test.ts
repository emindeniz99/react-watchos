import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../src/invoke";
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
});
