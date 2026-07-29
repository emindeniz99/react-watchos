import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ScenePhase } from "../src/index";
import {
  LUMINANCE_REDUCED_EVENT,
  MemoryHost,
  onLuminanceReduced,
  onScenePhase,
  SCENE_PHASE_EVENT,
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

  it("replays the last state to a listener that mounts later", () => {
    // The JSDoc promises the handler runs "once on mount with the current
    // state". Native pushes only at boot() and on wrist movement, so without a
    // replay a screen mounted while the wrist is ALREADY down would render
    // bright and keep its timers running until the wrist moves — the exact
    // drain this signal exists to remove. There is deliberately no getter, so
    // the replay is the only way a late subscriber can learn the state.
    mountApp(<Text>x</Text>, new MemoryHost());
    push()(LUMINANCE_REDUCED_EVENT, JSON.stringify({ reduced: true }));
    const seen: boolean[] = [];
    onLuminanceReduced((reduced) => seen.push(reduced));
    expect(seen).toEqual([true]);
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

describe("scene phase", () => {
  it("narrows the pushed string to the union, and never invents a phase", () => {
    // The wrapper exists because `registerNativeListener("scenePhase", …)` +
    // `String(p?.phase)` was the only way to read this, and that spells no
    // union. Native interpolates SwiftUI's `ScenePhase` case name, so the three
    // below are the whole documented vocabulary today.
    mountApp(<Text>x</Text>, new MemoryHost());
    const seen: ScenePhase[] = [];
    onScenePhase((phase) => seen.push(phase));
    for (const phase of ["inactive", "background", "active"]) {
      push()(SCENE_PHASE_EVENT, JSON.stringify({ phase }));
    }
    // A case SwiftUI adds after this binary ships, and a payload-less push,
    // both report `active` — i.e. equivalent to no push at all. Standing an app
    // down for a phase that might be on screen would be the worse guess.
    push()(SCENE_PHASE_EVENT, JSON.stringify({ phase: "someFuturePhase" }));
    push()(SCENE_PHASE_EVENT);
    expect(seen).toEqual([
      "inactive",
      "background",
      "active",
      "active",
      "active",
    ]);
  });

  it("replays the last phase to a listener that subscribes later", () => {
    // Level-triggered, exactly like luminance: `background` is a state the app
    // IS in and native pushes on every transition, so the last payload IS the
    // current phase. Without the replay a screen mounted while backgrounded
    // (a background-refresh wake rendering into a tree) believes it is active.
    mountApp(<Text>x</Text>, new MemoryHost());
    push()(SCENE_PHASE_EVENT, JSON.stringify({ phase: "background" }));
    const seen: ScenePhase[] = [];
    onScenePhase((phase) => seen.push(phase));
    expect(seen).toEqual(["background"]);
  });

  it("is not the Always-On signal — the two do not share a stream", () => {
    // The mistake the appState JSDoc has warned about since the luminance
    // work: a wrist-down app stays `active`, so an app that keys its
    // stand-down off scenePhase never sees the case that drains the battery.
    // Pinned as a test because "one of these is the other" is a plausible
    // simplification for someone consolidating two similar wrappers.
    mountApp(<Text>x</Text>, new MemoryHost());
    const phases: ScenePhase[] = [];
    const dims: boolean[] = [];
    onScenePhase((phase) => phases.push(phase));
    onLuminanceReduced((reduced) => dims.push(reduced));
    push()(LUMINANCE_REDUCED_EVENT, JSON.stringify({ reduced: true }));
    expect(dims).toEqual([true]);
    expect(phases).toEqual([]);
  });
});
