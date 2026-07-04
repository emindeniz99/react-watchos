import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_FINISHED_EVENT,
  BACKGROUND_REFRESH_EVENT,
  currentEntitlements,
  dispatchNativeEvent,
  enableWaterLock,
  getDeviceInfo,
  getProducts,
  Keychain,
  onAudioFinished,
  onBackgroundRefresh,
  onRuntimeSessionState,
  onRuntimeSessionWillExpire,
  onSpeechFinished,
  playAudio,
  purchase,
  RUNTIME_STATE_EVENT,
  RUNTIME_WILL_EXPIRE_EVENT,
  restorePurchases,
  SPEECH_FINISHED_EVENT,
  scheduleBackgroundRefresh,
  speak,
  startExtendedRuntimeSession,
  stopAudio,
  stopExtendedRuntimeSession,
  stopSpeaking,
  unregisterAllNativeListeners,
} from "../src/index";
import { installMockHost } from "./helpers";

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.__host;
  delete g.__resolveInvoke;
  delete g.__rejectInvoke;
  unregisterAllNativeListeners();
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

  it("enableWaterLock routes with no payload", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number, method: string) => {
      expect(method).toBe("enableWaterLock");
      (g.__resolveInvoke as (i: number, j: string) => void)(id, "null");
    });
    await expect(enableWaterLock()).resolves.toBeNull();
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

  it("playAudio forwards url + options", async () => {
    const host = installMockHost();
    let seen: unknown;
    host.invoke.mockImplementation(
      (id: number, method: string, json: string) => {
        expect(method).toBe("playAudio");
        seen = JSON.parse(json);
        (g.__resolveInvoke as (i: number, j: string) => void)(id, "null");
      },
    );
    await playAudio("https://cdn/clip.mp3", { volume: 0.8, loop: true });
    expect(seen).toEqual({
      url: "https://cdn/clip.mp3",
      volume: 0.8,
      loop: true,
    });
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

describe("capability push-event listeners", () => {
  it("onBackgroundRefresh / runtime / speech listeners fire and unsubscribe", () => {
    const bg = vi.fn();
    const state = vi.fn();
    const expire = vi.fn();
    const spoken = vi.fn();
    const played = vi.fn();
    const offs = [
      onBackgroundRefresh(bg),
      onRuntimeSessionState(state),
      onRuntimeSessionWillExpire(expire),
      onSpeechFinished(spoken),
      onAudioFinished(played),
    ];

    dispatchNativeEvent(BACKGROUND_REFRESH_EVENT, { userInfo: { a: 1 } });
    dispatchNativeEvent(RUNTIME_STATE_EVENT, { state: "running" });
    dispatchNativeEvent(RUNTIME_WILL_EXPIRE_EVENT, {});
    dispatchNativeEvent(SPEECH_FINISHED_EVENT, { text: "hi" });
    dispatchNativeEvent(AUDIO_FINISHED_EVENT, {});

    expect(bg).toHaveBeenCalledWith({ userInfo: { a: 1 } });
    expect(state).toHaveBeenCalledWith({ state: "running" });
    expect(expire).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith({ text: "hi" });
    expect(played).toHaveBeenCalledTimes(1);

    for (const off of offs) off();
    dispatchNativeEvent(BACKGROUND_REFRESH_EVENT, { userInfo: {} });
    dispatchNativeEvent(SPEECH_FINISHED_EVENT, { text: "again" });
    dispatchNativeEvent(AUDIO_FINISHED_EVENT, {});
    expect(bg).toHaveBeenCalledTimes(1); // no fire after unsubscribe
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(played).toHaveBeenCalledTimes(1);
  });

  // The Swift host pushes these exact event names (ReactWatchHost.swift
  // start() closures). Pin them so a JS rename can't silently desync from
  // native — the same drift-guard discipline as the codegen contract tests.
  it("event-name constants match the native push strings", () => {
    expect(BACKGROUND_REFRESH_EVENT).toBe("backgroundRefresh");
    expect(RUNTIME_STATE_EVENT).toBe("runtimeSession.state");
    expect(RUNTIME_WILL_EXPIRE_EVENT).toBe("runtimeSession.willExpire");
    expect(SPEECH_FINISHED_EVENT).toBe("speech.finished");
    expect(AUDIO_FINISHED_EVENT).toBe("audio.finished");
  });
});

describe("capability invoke — remaining paths", () => {
  it("Keychain.get returns null for an absent key; set/delete resolve", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation(
      (id: number, method: string, _json: string) => {
        const resolve = (j: string) =>
          (g.__resolveInvoke as (i: number, s: string) => void)(id, j);
        if (method === "keychainGet") resolve("null");
        else resolve("null"); // set/delete resolve void
      },
    );
    expect(await Keychain.get("missing")).toBeNull();
    await expect(Keychain.set("k", "v")).resolves.toBeNull();
    await expect(Keychain.delete("k")).resolves.toBeNull();
  });

  it("purchase success returns productId + transactionId", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (g.__resolveInvoke as (i: number, s: string) => void)(
        id,
        JSON.stringify({
          status: "success",
          productId: "pro.monthly",
          transactionId: "tx-1",
        }),
      );
    });
    const result = await purchase("pro.monthly");
    expect(result).toEqual({
      status: "success",
      productId: "pro.monthly",
      transactionId: "tx-1",
    });
  });

  it("currentEntitlements + restorePurchases return the id list", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number, method: string) => {
      expect(["currentEntitlements", "restorePurchases"]).toContain(method);
      (g.__resolveInvoke as (i: number, s: string) => void)(
        id,
        JSON.stringify(["pro.monthly"]),
      );
    });
    expect(await currentEntitlements()).toEqual(["pro.monthly"]);
    expect(await restorePurchases()).toEqual(["pro.monthly"]);
  });

  it("stopSpeaking + stopExtendedRuntimeSession route and settle", async () => {
    const host = installMockHost();
    const methods: string[] = [];
    host.invoke.mockImplementation((id: number, method: string) => {
      methods.push(method);
      (g.__resolveInvoke as (i: number, s: string) => void)(id, "null");
    });
    await stopSpeaking();
    await stopAudio();
    await stopExtendedRuntimeSession();
    expect(methods).toEqual([
      "stopSpeaking",
      "stopAudio",
      "stopExtendedRuntimeSession",
    ]);
  });
});
