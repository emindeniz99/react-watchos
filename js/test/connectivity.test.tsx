import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryHost,
  onPhoneMessage,
  runApp,
  sendToPhone,
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

function PhoneStatus() {
  const [status, setStatus] = useState("waiting");
  useEffect(() => {
    onPhoneMessage((p) => setStatus(String(p?.status ?? "")));
  }, []);
  return <Text>{status}</Text>;
}

type PushFn = (name: string, payload?: Record<string, unknown>) => boolean;

describe("WatchConnectivity bridge", () => {
  it("updates the UI live when a phone message is pushed", () => {
    const host = new MemoryHost();
    runApp(<PhoneStatus />, host);
    expect(host.lastCommit!.root!.props.text).toBe("waiting");

    // Simulate the native side delivering a phone message (WCSession ->
    // __pushNativeEvent("watchConnectivity", ...)).
    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    const handled = push("watchConnectivity", { status: "synced" });

    expect(handled).toBe(true);
    expect(host.lastCommit!.root!.props.text).toBe("synced");
  });

  it("sendToPhone forwards a JSON message to the host bridge", () => {
    const host = installMockHost();
    sendToPhone({ kind: "ping", n: 1 });
    expect(host.sendToPhone).toHaveBeenCalledTimes(1);
    expect(JSON.parse(host.sendToPhone.mock.calls[0][0])).toEqual({
      kind: "ping",
      n: 1,
    });
  });

  it("sendToPhone is a no-op without a connectivity-capable host", () => {
    expect(() => sendToPhone({ x: 1 })).not.toThrow();
  });
});
