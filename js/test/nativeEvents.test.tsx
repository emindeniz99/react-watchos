import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchNativeEvent,
  MemoryHost,
  registerNativeListener,
  Text,
} from "../src/index";
import { mountApp, resetApp } from "./helpers";

afterEach(resetApp);

function Connection() {
  const [status, setStatus] = useState("offline");
  useEffect(() => {
    registerNativeListener("connection", (p) =>
      setStatus(String(p?.status ?? "offline")),
    );
  }, []);
  return <Text>{status}</Text>;
}

type PushFn = (name: string, payloadJson?: string) => boolean;

describe("native event push (runSync)", () => {
  it("commits a native-pushed state change synchronously", () => {
    const host = new MemoryHost();
    mountApp(<Connection />, host);
    expect(host.lastCommit!.root!.props.text).toBe("offline");
    const commitsBefore = host.commits.length;

    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    const handled = push("connection", JSON.stringify({ status: "online" }));

    // No awaiting/microtask flush: the new tree is already committed.
    expect(handled).toBe(true);
    expect(host.commits.length).toBeGreaterThan(commitsBefore);
    expect(host.lastCommit!.root!.props.text).toBe("online");
  });

  it("returns false for an unregistered native event", () => {
    const host = new MemoryHost();
    mountApp(<Connection />, host);
    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    expect(push("unknown")).toBe(false);
  });
});

describe("native event listeners", () => {
  it("fans out to every handler on the same event", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerNativeListener("x", a);
    registerNativeListener("x", b);

    expect(dispatchNativeEvent("x", { v: 1 })).toBe(true);
    expect(a).toHaveBeenCalledWith({ v: 1 });
    expect(b).toHaveBeenCalledWith({ v: 1 });
  });

  it("unsubscribe removes only its own handler", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerNativeListener("x", a);
    registerNativeListener("x", b);

    offA();
    expect(dispatchNativeEvent("x")).toBe(true); // b still listening
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("returns false once the last handler unsubscribes", () => {
    const off = registerNativeListener("x", vi.fn());
    off();
    expect(dispatchNativeEvent("x")).toBe(false);
  });

  it("subscribing the same handler twice gives each subscription its own identity", () => {
    // A plain Set<handler> dedupes by function identity: subscribing the SAME
    // function twice collapsed to one Set member, so unsubscribing ONE of the
    // two calls deleted it outright — silencing the still-registered second
    // subscription (whose own cleanup hasn't run yet) while any shared native
    // stream backing it (startSensor) keeps running. Each call must get an
    // independent identity so its own cleanup — and only its own — removes it.
    const shared = vi.fn();
    const offFirst = registerNativeListener("x", shared);
    registerNativeListener("x", shared); // same function, second subscription

    offFirst(); // unsubscribes only the FIRST of the two

    expect(dispatchNativeEvent("x", { v: 1 })).toBe(true);
    // The second subscription is still live and must still fire.
    expect(shared).toHaveBeenCalledTimes(1);
    expect(shared).toHaveBeenCalledWith({ v: 1 });
  });

  it("isolates a throwing listener — the others still get the payload", () => {
    // One bad listener for a native push (ble.state, connection, sensor…) must
    // not starve every later-registered one (the deep review caught this).
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = vi.fn();
    const thrower = vi.fn(() => {
      throw new Error("boom");
    });
    const after = vi.fn();
    registerNativeListener("x", before);
    registerNativeListener("x", thrower);
    registerNativeListener("x", after);

    expect(dispatchNativeEvent("x", { v: 1 })).toBe(true);
    expect(before).toHaveBeenCalledWith({ v: 1 });
    expect(after).toHaveBeenCalledWith({ v: 1 }); // not starved by the thrower
    expect(spy).toHaveBeenCalled(); // surfaced, not swallowed
    spy.mockRestore();
  });
});
