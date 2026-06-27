import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleIntent,
  registerIntent,
  Storage,
  unregisterAllIntents,
} from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  unregisterAllIntents();
  delete (globalThis as Record<string, unknown>).__host;
});

describe("intents", () => {
  it("dispatches a registered intent", () => {
    const handler = vi.fn();
    registerIntent("addGlass", handler);
    expect(handleIntent("addGlass")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("parses the params JSON for the handler", () => {
    const handler = vi.fn();
    registerIntent("setGlasses", handler);
    handleIntent("setGlasses", JSON.stringify({ count: 4 }));
    expect(handler).toHaveBeenCalledWith({ count: 4 });
  });

  it("returns false for unknown intents", () => {
    expect(handleIntent("nope")).toBe(false);
  });

  it("exposes __handleIntent for the Swift intent runtime", () => {
    const handler = vi.fn();
    registerIntent("fromNative", handler);
    const dispatch = (
      globalThis as { __handleIntent?: (name: string) => boolean }
    ).__handleIntent;
    expect(dispatch?.("fromNative")).toBe(true);
    expect(handler).toHaveBeenCalled();
  });
});

// Glance-style auto-reload: the framework, not the handler, reloads the widget
// when persisted state changes — so an Action-button tap can never silently
// no-op because the author forgot to publishWidgets(), and a no-op intent never
// spends the WidgetKit reload budget.
describe("intent auto-reload", () => {
  it("reloads the widget when the handler changed Storage — without it calling publishWidgets()", () => {
    const host = installMockHost();
    // Note: the handler does NOT call publishWidgets(); the storage write is the
    // reload signal. This is the footgun being removed.
    registerIntent("addGlass", () => {
      Storage.set("hydration.glasses", 3);
    });
    handleIntent("addGlass");
    expect(host.publishWidgets).toHaveBeenCalledTimes(1);
  });

  it("does NOT reload a no-op intent (read-only handler) — protects the reload budget", () => {
    const host = installMockHost();
    registerIntent("peek", () => {
      Storage.getString("hydration.glasses"); // read only, no write
    });
    handleIntent("peek");
    expect(host.publishWidgets).not.toHaveBeenCalled();
  });

  it("coalesces multiple writes in one handler into a single reload", () => {
    const host = installMockHost();
    registerIntent("bulk", () => {
      Storage.set("a", 1);
      Storage.set("b", 2);
      Storage.set("c", 3);
    });
    handleIntent("bulk");
    expect(host.publishWidgets).toHaveBeenCalledTimes(1);
  });

  it("reloads even if the handler throws AFTER persisting (state mustn't diverge)", () => {
    const host = installMockHost();
    // The exact shape of an interactive widget button's intent: write, then a
    // later line throws. The write already landed in shared Storage, so the
    // complication MUST still republish (the deep review caught this).
    registerIntent("bumpThenThrow", () => {
      Storage.counterAdd("taps", 1, 0, 999);
      throw new Error("boom");
    });
    expect(() => handleIntent("bumpThenThrow")).toThrow("boom");
    expect(host.publishWidgets).toHaveBeenCalledTimes(1);
  });
});
