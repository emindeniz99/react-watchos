import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchNativeEvent,
  MemoryHost,
  registerNativeListener,
  runApp,
  Text,
  unregisterAllNativeListeners,
} from "../src/index";

afterEach(() => {
  unregisterAllNativeListeners();
  delete (globalThis as Record<string, unknown>).__pushNativeEvent;
  delete (globalThis as Record<string, unknown>).__dispatchEvent;
});

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
    runApp(<Connection />, host);
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
    runApp(<Connection />, host);
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
});
