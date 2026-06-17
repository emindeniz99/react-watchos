import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
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
