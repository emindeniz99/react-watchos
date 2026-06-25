import { afterEach, describe, expect, it } from "vitest";
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
