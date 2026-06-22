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

  it("connect/write/subscribe forward op messages to the host", () => {
    const host = installMockHost();
    bleConnect("ABCD");
    bleWrite("play", "1");
    bleSubscribe("position");

    const ops = host.ble.mock.calls.map((c) => JSON.parse(c[0]));
    expect(ops).toEqual([
      { op: "connect", service: "ABCD" },
      { op: "write", characteristic: "play", value: "1" },
      { op: "subscribe", characteristic: "position" },
    ]);
  });

  it("forwards the reliable-write option only when set", () => {
    const host = installMockHost();
    bleWrite("next", "1"); // default: bridge decides
    bleWrite("next", "1", { confirm: true }); // reliable (.withResponse)
    bleWrite("next", "1", { confirm: false }); // fast (.withoutResponse)

    const ops = host.ble.mock.calls.map((c) => JSON.parse(c[0]));
    expect(ops).toEqual([
      { op: "write", characteristic: "next", value: "1" },
      { op: "write", characteristic: "next", value: "1", confirm: true },
      { op: "write", characteristic: "next", value: "1", confirm: false },
    ]);
  });

  it("is a no-op without a BLE-capable host", () => {
    expect(() => bleConnect("X")).not.toThrow();
  });
});
