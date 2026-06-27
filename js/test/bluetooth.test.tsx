import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  bleConnect,
  bleSubscribe,
  bleWrite,
  MemoryHost,
  onBleNotify,
  runApp,
  Text,
  unregisterAllNativeListeners,
} from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  unregisterAllNativeListeners();
  delete (globalThis as Record<string, unknown>).__host;
  delete (globalThis as Record<string, unknown>).__pushNativeEvent;
  delete (globalThis as Record<string, unknown>).__dispatchEvent;
});

function NowPlaying() {
  const [title, setTitle] = useState("nothing");
  useEffect(() => {
    onBleNotify((p) => {
      if (p?.characteristic === "title") setTitle(String(p.value));
    });
  }, []);
  return <Text>{title}</Text>;
}

type PushFn = (name: string, payloadJson?: string) => boolean;

describe("BLE bridge", () => {
  it("updates the UI live from a characteristic notification", () => {
    const host = new MemoryHost();
    runApp(<NowPlaying />, host);
    expect(host.lastCommit!.root!.props.text).toBe("nothing");

    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    const handled = push(
      "ble.notify",
      JSON.stringify({ characteristic: "title", value: "Blade Runner" }),
    );

    expect(handled).toBe(true);
    expect(host.lastCommit!.root!.props.text).toBe("Blade Runner");
  });

  it("connect/write/subscribe settle through the invoke channel", async () => {
    const host = installMockHost();
    // Each returns a Promise that resolves on the correlated result (CX-022).
    await Promise.all([
      bleConnect("ABCD"),
      bleWrite("play", "1"),
      bleSubscribe("position"),
    ]);

    const calls = host.invoke.mock.calls
      .filter((c) => String(c[1]).startsWith("ble"))
      .map((c) => [c[1], JSON.parse(c[2])]);
    expect(calls).toEqual([
      ["bleConnect", { service: "ABCD" }],
      ["bleWrite", { characteristic: "play", value: "1" }],
      ["bleSubscribe", { characteristic: "position" }],
    ]);
  });

  it("forwards the reliable-write option only when set", async () => {
    const host = installMockHost();
    await bleWrite("next", "1"); // default: bridge decides
    await bleWrite("next", "1", { confirm: true }); // reliable (.withResponse)
    await bleWrite("next", "1", { confirm: false }); // fast (.withoutResponse)

    const writes = host.invoke.mock.calls
      .filter((c) => c[1] === "bleWrite")
      .map((c) => JSON.parse(c[2]));
    expect(writes).toEqual([
      { characteristic: "next", value: "1" },
      { characteristic: "next", value: "1", confirm: true },
      { characteristic: "next", value: "1", confirm: false },
    ]);
  });

  it("rejects (not hangs) without an invoke-capable host", async () => {
    // No host installed (afterEach cleared it) — the promise rejects with a
    // machine code rather than leaving JS awaiting forever.
    await expect(bleConnect("X")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });
});
