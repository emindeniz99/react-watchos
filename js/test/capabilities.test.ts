import { afterEach, describe, expect, it } from "vitest";
import {
  getDeviceInfo,
  getProducts,
  Keychain,
  purchase,
  scheduleBackgroundRefresh,
  speak,
  startExtendedRuntimeSession,
} from "../src/index";
import { installMockHost } from "./helpers";

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.__host;
  delete g.__resolveInvoke;
  delete g.__rejectInvoke;
});

// The capability modules all route through the generic invoke channel (SD-1),
// so these tests assert they hand the right method + payload to __host.invoke
// and surface the resolved result — the native side is macOS-build-gated.

describe("capability modules route through invoke", () => {
  it("getDeviceInfo requests the snapshot and returns it", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number, method: string) => {
      expect(method).toBe("getDeviceInfo");
      (g.__resolveInvoke as (i: number, j: string) => void)(
        id,
        JSON.stringify({ batteryLevel: 0.8, model: "Watch" }),
      );
    });
    const info = await getDeviceInfo();
    expect(info.batteryLevel).toBe(0.8);
    expect(info.model).toBe("Watch");
  });

  it("scheduleBackgroundRefresh forwards afterMs + userInfo", async () => {
    const host = installMockHost();
    let seen: unknown;
    host.invoke.mockImplementation(
      (id: number, method: string, json: string) => {
        expect(method).toBe("scheduleBackgroundRefresh");
        seen = JSON.parse(json);
        (g.__resolveInvoke as (i: number, j: string) => void)(id, "null");
      },
    );
    await scheduleBackgroundRefresh(60_000, { reason: "sync" });
    expect(seen).toEqual({ afterMs: 60_000, userInfo: { reason: "sync" } });
  });

  it("Keychain.get returns the stored string or null", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation(
      (id: number, method: string, json: string) => {
        expect(method).toBe("keychainGet");
        expect(JSON.parse(json)).toEqual({ key: "token" });
        (g.__resolveInvoke as (i: number, j: string) => void)(id, '"secret"');
      },
    );
    expect(await Keychain.get("token")).toBe("secret");
  });

  it("speak forwards text + options", async () => {
    const host = installMockHost();
    let seen: unknown;
    host.invoke.mockImplementation(
      (id: number, method: string, json: string) => {
        expect(method).toBe("speak");
        seen = JSON.parse(json);
        (g.__resolveInvoke as (i: number, j: string) => void)(id, "null");
      },
    );
    await speak("hello", { rate: 0.5, language: "en-US" });
    expect(seen).toEqual({ text: "hello", rate: 0.5, language: "en-US" });
  });

  it("startExtendedRuntimeSession routes with no payload", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number, method: string) => {
      expect(method).toBe("startExtendedRuntimeSession");
      (g.__resolveInvoke as (i: number, j: string) => void)(id, "null");
    });
    // void invoke resolves with null (JSON.parse("null")); just confirm it settles.
    await expect(startExtendedRuntimeSession()).resolves.toBeNull();
  });

  it("getProducts sends the id list and decodes products", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation(
      (id: number, method: string, json: string) => {
        expect(method).toBe("getProducts");
        expect(JSON.parse(json)).toEqual({ productIds: ["pro.monthly"] });
        (g.__resolveInvoke as (i: number, j: string) => void)(
          id,
          JSON.stringify([{ id: "pro.monthly", displayPrice: "$1.99" }]),
        );
      },
    );
    const products = await getProducts(["pro.monthly"]);
    expect(products[0]?.displayPrice).toBe("$1.99");
  });

  it("purchase surfaces a user cancel as a resolved status", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (g.__resolveInvoke as (i: number, j: string) => void)(
        id,
        JSON.stringify({ status: "userCancelled" }),
      );
    });
    expect((await purchase("pro.monthly")).status).toBe("userCancelled");
  });
});
