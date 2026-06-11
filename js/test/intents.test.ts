import { afterEach, describe, expect, it, vi } from "vitest";
import { handleIntent, registerIntent, unregisterAllIntents } from "../src/index";

afterEach(() => {
  unregisterAllIntents();
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
