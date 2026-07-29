import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ConnectivityState,
  FileTransferResult,
  ReceivedFile,
} from "../src/index";
import {
  cancelFileTransfer,
  defineMessages,
  deleteReceivedFile,
  getConnectivityState,
  MemoryHost,
  onApplicationContext,
  onConnectivityState,
  onFileTransfer,
  onPhoneMessage,
  onReceivedFile,
  onUserInfo,
  outstandingFileTransfers,
  sendToPhone,
  Text,
  transferFile,
  transferUserInfo,
  updateApplicationContext,
} from "../src/index";
import { installMockHost, mountApp, resetApp } from "./helpers";

afterEach(resetApp);

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
    mountApp(<PhoneStatus />, host);
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

  it("background channels forward their payloads through invoke", async () => {
    const host = installMockHost();
    await updateApplicationContext({ theme: "dark", glasses: 3 });
    await transferUserInfo({ workout: "run", seq: 7 });

    const calls = host.invoke.mock.calls
      .filter(
        (c) =>
          String(c[1]).startsWith("update") ||
          String(c[1]).startsWith("transfer"),
      )
      .map((c) => [c[1], JSON.parse(c[2])]);
    expect(calls).toEqual([
      ["updateApplicationContext", { theme: "dark", glasses: 3 }],
      ["transferUserInfo", { workout: "run", seq: 7 }],
    ]);
  });

  it("routes each delivery channel to its own listener (ARCH-12 split)", () => {
    // mountApp installs __pushNativeEvent (the native push entry point).
    mountApp(<Text>x</Text>, new MemoryHost());
    const seen: Record<string, unknown[]> = { msg: [], ctx: [], info: [] };
    onPhoneMessage((p) => seen.msg.push(p?.v));
    onApplicationContext((p) => seen.ctx.push(p?.v));
    onUserInfo((p) => seen.info.push(p?.v));

    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    push("watchConnectivity", JSON.stringify({ v: "m" }));
    push("watchConnectivity.applicationContext", JSON.stringify({ v: "c" }));
    push("watchConnectivity.userInfo", JSON.stringify({ v: "u" }));

    // The channels carry different guarantees; a listener must never see a
    // sibling channel's payload.
    expect(seen).toEqual({ msg: ["m"], ctx: ["c"], info: ["u"] });
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
    mountApp(<View />, host);
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

describe("file transfer", () => {
  it("omits `metadata` entirely when the caller passed none", async () => {
    // Not `metadata: undefined`: the payload is JSON.stringify'd, and an
    // explicit undefined would be dropped there anyway — but a `null` or `{}`
    // would reach WCSession as a metadata dictionary the caller never asked
    // for, and a non-plist value in it fails the whole transfer.
    const host = installMockHost();
    host.invoke.mockImplementation((id: number, _m: string) => {
      (
        globalThis as { __resolveInvoke?: (i: number, j: string) => void }
      ).__resolveInvoke?.(id, JSON.stringify({ id: 7 }));
    });
    const handle = await transferFile("file:///var/tmp/run.gpx");
    expect(JSON.parse(host.invoke.mock.calls[0]?.[2] as string)).toEqual({
      path: "file:///var/tmp/run.gpx",
    });
    expect(handle).toEqual({ id: 7 });

    await transferFile("file:///var/tmp/run.gpx", { workoutId: "w-42" });
    expect(JSON.parse(host.invoke.mock.calls[1]?.[2] as string)).toEqual({
      path: "file:///var/tmp/run.gpx",
      metadata: { workoutId: "w-42" },
    });
  });

  it("cancel and delete address the transfer by id and the file by path", async () => {
    const host = installMockHost();
    await cancelFileTransfer(7);
    await deleteReceivedFile("file:///inbox/1-1-export.json");
    expect(
      host.invoke.mock.calls.map((c) => [c[1], JSON.parse(c[2] as string)]),
    ).toEqual([
      ["cancelFileTransfer", { id: 7 }],
      ["deleteReceivedFile", { path: "file:///inbox/1-1-export.json" }],
    ]);
  });

  it("outstandingFileTransfers surfaces the id-less previous-launch entry", async () => {
    // The case the optional `id` exists for: WCSession's queue survives the
    // process, so a transfer can outlive the launch that minted its id.
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (
        globalThis as { __resolveInvoke?: (i: number, j: string) => void }
      ).__resolveInvoke?.(
        id,
        JSON.stringify([
          { id: 3, name: "a.gpx", transferring: true, fractionCompleted: 0.5 },
          { name: "b.json", transferring: false, fractionCompleted: 1 },
        ]),
      );
    });
    const transfers = await outstandingFileTransfers();
    expect(transfers[1]?.id).toBeUndefined();
    expect(transfers[0]?.id).toBe(3);
  });

  it("onReceivedFile hands the handler a complete, defaulted ReceivedFile", () => {
    mountApp(<Text>x</Text>, new MemoryHost());
    const seen: ReceivedFile[] = [];
    onReceivedFile((file) => seen.push(file));
    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    push(
      "watchConnectivity.file",
      JSON.stringify({
        path: "file:///inbox/1-1-run.gpx",
        name: "run.gpx",
        size: 2048,
        metadata: { workoutId: "w-42" },
        receivedAt: 1_768_483_200_000,
      }),
    );
    // A sender that passed no metadata: `{}`, never undefined, so a consumer
    // can read `file.metadata.x` without a guard.
    push(
      "watchConnectivity.file",
      JSON.stringify({ path: "file:///inbox/2-1-x", name: "x", size: 1 }),
    );
    expect(seen[0]).toEqual({
      path: "file:///inbox/1-1-run.gpx",
      name: "run.gpx",
      size: 2048,
      metadata: { workoutId: "w-42" },
      receivedAt: 1_768_483_200_000,
    });
    expect(seen[1]?.metadata).toEqual({});
    expect(seen[1]?.receivedAt).toBe(0);
  });

  it("onFileTransfer reports a previous launch's completion as id: null", () => {
    mountApp(<Text>x</Text>, new MemoryHost());
    const seen: FileTransferResult[] = [];
    onFileTransfer((result) => seen.push(result));
    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    push(
      "watchConnectivity.fileTransfer",
      JSON.stringify({ id: 3, state: "finished" }),
    );
    push(
      "watchConnectivity.fileTransfer",
      JSON.stringify({
        state: "failed",
        error: "not enough space",
        code: "insufficientSpace",
      }),
    );
    expect(seen[0]).toEqual({ id: 3, state: "finished" });
    expect(seen[1]).toEqual({
      id: null,
      state: "failed",
      error: "not enough space",
      code: "insufficientSpace",
    });
  });
});

describe("session state is observability, not a gate", () => {
  it("getConnectivityState returns the snapshot verbatim", async () => {
    const host = installMockHost();
    const state: ConnectivityState = {
      activationState: "activated",
      reachable: false,
      companionAppInstalled: true,
      hasContentPending: true,
    };
    host.invoke.mockImplementation((id: number) => {
      (
        globalThis as { __resolveInvoke?: (i: number, j: string) => void }
      ).__resolveInvoke?.(id, JSON.stringify(state));
    });
    expect(await getConnectivityState()).toEqual(state);
  });

  it("onConnectivityState degrades an unknown activation state to notActivated", () => {
    // `activationState` is a closed union on the wire. A value from a newer or
    // broken binary must land on the SAFE member — "not activated" is the one
    // that makes a consumer show "disconnected" rather than claim a live link.
    mountApp(<Text>x</Text>, new MemoryHost());
    const seen: ConnectivityState[] = [];
    onConnectivityState((state) => seen.push(state));
    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    push(
      "watchConnectivity.state",
      JSON.stringify({
        activationState: "somethingNew",
        reachable: true,
        companionAppInstalled: true,
        hasContentPending: false,
      }),
    );
    push("watchConnectivity.state", JSON.stringify({}));
    expect(seen[0]?.activationState).toBe("notActivated");
    expect(seen[0]?.reachable).toBe(true);
    expect(seen[1]).toEqual({
      activationState: "notActivated",
      reachable: false,
      companionAppInstalled: false,
      hasContentPending: false,
    });
  });
});
