import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  defineMessages,
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

type PushFn = (name: string, payloadJson?: string) => boolean;

describe("WatchConnectivity bridge", () => {
  it("updates the UI live when a phone message is pushed", () => {
    const host = new MemoryHost();
    runApp(<PhoneStatus />, host);
    expect(host.lastCommit!.root!.props.text).toBe("waiting");

    // Simulate the native side delivering a phone message (WCSession ->
    // __pushNativeEvent("watchConnectivity", ...)).
    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    const handled = push(
      "watchConnectivity",
      JSON.stringify({ status: "synced" }),
    );

    expect(handled).toBe(true);
    expect(host.lastCommit!.root!.props.text).toBe("synced");
  });

  it("sendToPhone forwards a JSON message through invoke and resolves the reply", async () => {
    const host = installMockHost();
    const reply = await sendToPhone({ kind: "ping", n: 1 });
    expect(host.invoke).toHaveBeenCalledWith(
      expect.any(Number),
      "sendToPhone",
      JSON.stringify({ kind: "ping", n: 1 }),
    );
    expect(reply).toEqual({ ok: true });
  });

  it("sendToPhone rejects (UNAVAILABLE) without a connectivity-capable host", async () => {
    await expect(sendToPhone({ x: 1 })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  // DX-6: the typed message contract — define once, type-checked on both sides.
  it("defineMessages.send forwards a typed { type, payload } envelope", async () => {
    const host = installMockHost();
    const messages = defineMessages<{ togglePlay: { on: boolean } }>();
    const reply = await messages.send("togglePlay", { on: true });
    expect(host.invoke).toHaveBeenCalledWith(
      expect.any(Number),
      "sendToPhone",
      JSON.stringify({ type: "togglePlay", payload: { on: true } }),
    );
    expect(reply).toEqual({ ok: true });
  });

  it("defineMessages.on dispatches by type and ignores other messages", () => {
    const messages = defineMessages<{ sync: { status: string } }>();
    function View() {
      const [s, setS] = useState("waiting");
      useEffect(() => messages.on("sync", (p) => setS(p.status)), []);
      return <Text>{s}</Text>;
    }
    const host = new MemoryHost();
    runApp(<View />, host);
    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;

    // A different message name is ignored (no re-render to it).
    push(
      "watchConnectivity",
      JSON.stringify({ type: "other", payload: { status: "nope" } }),
    );
    expect(host.lastCommit!.root!.props.text).toBe("waiting");

    // The matching name delivers the typed payload.
    push(
      "watchConnectivity",
      JSON.stringify({ type: "sync", payload: { status: "done" } }),
    );
    expect(host.lastCommit!.root!.props.text).toBe("done");
  });
});
