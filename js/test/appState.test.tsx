import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  LUMINANCE_REDUCED_EVENT,
  MemoryHost,
  onLuminanceReduced,
  Text,
} from "../src/index";
import { mountApp, resetApp } from "./helpers";

afterEach(resetApp);

type PushFn = (name: string, payloadJson?: string) => boolean;

const push = () =>
  (globalThis as { __pushNativeEvent?: PushFn }).__pushNativeEvent!;

describe("Always-On luminance", () => {
  it("unwraps the payload to a bare boolean", () => {
    // The onRemotePushToken shape: a single-field event whose consumer would
    // otherwise write `p?.reduced` on every call site.
    mountApp(<Text>x</Text>, new MemoryHost());
    const seen: boolean[] = [];
    onLuminanceReduced((reduced) => seen.push(reduced));
    push()(LUMINANCE_REDUCED_EVENT, JSON.stringify({ reduced: true }));
    push()(LUMINANCE_REDUCED_EVENT, JSON.stringify({ reduced: false }));
    // A payload-less push is "not reduced", not a crash.
    push()(LUMINANCE_REDUCED_EVENT);
    expect(seen).toEqual([true, false, false]);
  });

  it("commits the resulting state change immediately, like a tap", () => {
    // The whole point is standing work DOWN, so the re-render that stops a
    // timer must not wait for the scheduler's next turn.
    function Dimmable() {
      const [dimmed, setDimmed] = useState(false);
      useEffect(() => onLuminanceReduced(setDimmed), []);
      return <Text>{dimmed ? "dimmed" : "bright"}</Text>;
    }
    const host = new MemoryHost();
    mountApp(<Dimmable />, host);
    expect(host.lastCommit?.root?.props.text).toBe("bright");
    expect(
      push()(LUMINANCE_REDUCED_EVENT, JSON.stringify({ reduced: true })),
    ).toBe(true);
    expect(host.lastCommit?.root?.props.text).toBe("dimmed");
  });

  it("is a PUSH event only — no invoke, no host method, no feature", async () => {
    // Recorded as a test because it is a design decision that would be easy to
    // "fix" later by adding a getter. The state is only ever pushed; there is
    // no `getLuminanceReduced` to drift from it, and nothing for a HostPolicy
    // to gate (scenePhase/openURL/backgroundRefresh are the same shape).
    const { HOST_METHODS } = await import("../src/generated/wire");
    expect(
      HOST_METHODS.filter((m) => m.name.toLowerCase().includes("luminance")),
    ).toEqual([]);
  });
});
