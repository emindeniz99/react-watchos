import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  dispatchNativeEvent,
  MemoryHost,
  registerNativeListener,
  runApp,
  Text,
  unregisterAllNativeListeners,
} from "../src/index";
import { resetApp } from "./helpers";

afterEach(resetApp);

type PushFn = (name: string, payloadJson?: string) => boolean;
type DispatchFn = (nodeId: number, event: string) => string;
type InspectFn = () => { commits: number };

function g() {
  return globalThis as Record<string, unknown>;
}

/**
 * ARCH-08. These encode WHY the root has a teardown at all: an abandoned root
 * stays mounted, keeps its effect-registered native listeners in the shared
 * table, and keeps committing into a host nobody reads — the silent
 * double-mount the 2026-06-25 review found.
 */
describe("WatchRoot.dispose (ARCH-08)", () => {
  it("uninstalls exactly the four globals runApp installed", () => {
    const root = runApp(<Text>hi</Text>, new MemoryHost());
    expect(typeof g().__dispatchEvent).toBe("function");
    expect(typeof g().__pushNativeEvent).toBe("function");
    expect(typeof g().__inspect).toBe("function");
    expect(typeof g().__disposeActiveRoot).toBe("function");

    root.dispose();

    expect(g().__dispatchEvent).toBeUndefined();
    expect(g().__pushNativeEvent).toBeUndefined();
    expect(g().__inspect).toBeUndefined();
    expect(g().__disposeActiveRoot).toBeUndefined();
  });

  it("runs effect cleanups, so a disposed root stops receiving native events", () => {
    const seen: string[] = [];
    function Listener() {
      useEffect(
        () =>
          registerNativeListener("connection", (p) => {
            seen.push(String(p?.status));
          }),
        [],
      );
      return <Text>x</Text>;
    }
    const root = runApp(<Listener />, new MemoryHost());
    expect(dispatchNativeEvent("connection", { status: "online" })).toBe(true);
    expect(seen).toEqual(["online"]);

    root.dispose();

    // The unmount ran the effect's cleanup, which unregistered the listener —
    // this is the leak that made a second runApp fan every native push out to
    // BOTH roots, the stale one committing into its dead host.
    expect(dispatchNativeEvent("connection", { status: "offline" })).toBe(
      false,
    );
    expect(seen).toEqual(["online"]);
  });

  it("is idempotent", () => {
    const root = runApp(<Text>hi</Text>, new MemoryHost());
    root.dispose();
    expect(() => root.dispose()).not.toThrow();
  });

  it("throws loudly on every entry point after dispose", () => {
    const host = new MemoryHost();
    const root = runApp(<Text>hi</Text>, host);
    root.dispose();

    expect(() => root.render(<Text>again</Text>)).toThrow(/disposed/);
    expect(() => root.dispatchEvent({ nodeId: 1, event: "press" })).toThrow(
      /disposed/,
    );
    expect(() => root.runSync(() => 1)).toThrow(/disposed/);
    expect(() => root.inspect()).toThrow(/disposed/);
  });

  it("a superseded root's late dispose leaves the live root's globals alone", () => {
    const first = runApp(<Text>first</Text>, new MemoryHost());
    first.dispose();

    const second = runApp(<Text>second</Text>, new MemoryHost());
    const dispatch = g().__dispatchEvent;
    const push = g().__pushNativeEvent;
    const inspect = g().__inspect;

    // A stale reference calling dispose() again must not tear down its
    // successor's entry points (the identity check in runApp).
    first.dispose();

    expect(g().__dispatchEvent).toBe(dispatch);
    expect(g().__pushNativeEvent).toBe(push);
    expect(g().__inspect).toBe(inspect);
    expect((g().__inspect as InspectFn)().commits).toBeGreaterThanOrEqual(1);
    second.dispose();
  });

  it("a second runApp throws instead of silently superseding the live root", () => {
    const first = runApp(<Text>first</Text>, new MemoryHost());
    expect(() => runApp(<Text>second</Text>, new MemoryHost())).toThrow(
      /already mounted — call root\.dispose\(\) first/,
    );
    // The live root is untouched by the rejected mount.
    expect((g().__inspect as InspectFn)().commits).toBeGreaterThanOrEqual(1);
    first.dispose();
    // …and the slot is released, so the next mount succeeds.
    runApp(<Text>second</Text>, new MemoryHost()).dispose();
  });

  it("releases the single-root slot when the first render throws", () => {
    function Boom(): never {
      throw new Error("render exploded");
    }
    expect(() => runApp(<Boom />, new MemoryHost())).toThrow(/render exploded/);
    // A failed mount must not hold the slot hostage: the next runApp reports
    // its OWN outcome, not "a root is already mounted".
    expect(g().__dispatchEvent).toBeUndefined();
    runApp(<Text>ok</Text>, new MemoryHost()).dispose();
  });

  it("the uninstalled globals are the ones that reached the root", () => {
    const host = new MemoryHost();
    const root = runApp(<Text>hi</Text>, host);
    const push = g().__pushNativeEvent as PushFn;
    const dispatch = g().__dispatchEvent as DispatchFn;
    // Captured references keep working only while the root is live; after
    // dispose they hit the throw-guard rather than mutating a dead tree.
    expect(push("nobody-listens")).toBe(false);
    root.dispose();
    expect(() => push("nobody-listens")).toThrow(/disposed/);
    expect(() => dispatch(1, "press")).toThrow(/disposed/);
    unregisterAllNativeListeners();
  });
});

/**
 * ARCH-08, the same-CONTEXT re-evaluation half. `activeRoot` lives in the
 * bundle's IIFE scope, so a second `js.evaluate(bundle)` — what the OTA→shipped
 * fallback does after a bad bundle throws — gets a fresh module scope on a
 * context whose globals persist. The single-root guard cannot see the previous
 * evaluation's root, so the native side needs a global hook to tear it down
 * first, or the failed bundle's tree stays mounted with its listeners and
 * sensor streams live for the rest of the generation.
 */
describe("__disposeActiveRoot (native teardown hook, ARCH-08)", () => {
  it("disposes the live root, releasing its listeners and the single-root slot", () => {
    function Listener() {
      useEffect(() => registerNativeListener("connection", () => {}), []);
      return <Text>x</Text>;
    }
    runApp(<Listener />, new MemoryHost());
    expect(dispatchNativeEvent("connection", {})).toBe(true);

    // Stands in for Swift's `globalThis.__disposeActiveRoot?.()` before it
    // evaluates the fallback bundle into the same runtime.
    (g().__disposeActiveRoot as () => void)();

    expect(dispatchNativeEvent("connection", {})).toBe(false);
    expect(g().__dispatchEvent).toBeUndefined();
    expect(g().__disposeActiveRoot).toBeUndefined();
    // The fallback bundle can now mount — this is the whole point of the hook.
    runApp(<Text>fallback</Text>, new MemoryHost()).dispose();
  });

  it("a superseded root's hook does not tear down the live root", () => {
    const first = runApp(<Text>first</Text>, new MemoryHost());
    const staleHook = g().__disposeActiveRoot as () => void;
    first.dispose();

    const second = runApp(<Text>second</Text>, new MemoryHost());
    staleHook();

    // Identity-checked like the other three globals: the stale hook's own
    // dispose() is a no-op, and it must not uninstall its successor's.
    expect(typeof g().__disposeActiveRoot).toBe("function");
    expect((g().__inspect as InspectFn)().commits).toBeGreaterThanOrEqual(1);
    second.dispose();
  });
});
