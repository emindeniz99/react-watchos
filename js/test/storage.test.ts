import { afterEach, describe, expect, it } from "vitest";
import { Storage } from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  Storage.clearMemoryFallback();
  delete (globalThis as Record<string, unknown>).__host;
});

describe("Storage", () => {
  it("round-trips JSON values through the in-memory fallback", () => {
    expect(Storage.get("missing")).toBeNull();
    Storage.set("glasses", 3);
    expect(Storage.get<number>("glasses")).toBe(3);
    Storage.set("obj", { a: [1, 2] });
    expect(Storage.get("obj")).toEqual({ a: [1, 2] });
  });

  it("throws on a non-JSON-serializable value instead of corrupting", () => {
    // JSON.stringify(undefined) is undefined — the old code persisted the
    // literal string "undefined", which get() could never parse back.
    expect(() => Storage.set("k", undefined)).toThrow(TypeError);
    expect(() => Storage.set("k", () => {})).toThrow(TypeError);
    expect(Storage.get("k")).toBeNull(); // nothing was written
    Storage.set("k", null); // the documented way to clear
    expect(Storage.get("k")).toBeNull();
  });

  it("uses the host storage bridge when available", () => {
    const backing = new Map<string, string>();
    const host = installMockHost();
    host.getItem.mockImplementation((key: string) => backing.get(key) ?? null);
    host.setItem.mockImplementation((key: string, value: string) => {
      backing.set(key, value);
    });

    Storage.set("glasses", 5);
    expect(backing.get("glasses")).toBe("5");
    expect(Storage.get<number>("glasses")).toBe(5);
  });

  it("returns null for corrupt stored JSON instead of throwing", () => {
    installMockHost().getItem.mockReturnValue("{not json");
    expect(Storage.get("anything")).toBeNull();
  });
});

// ARCH-05: counters are a SEPARATE, cross-process-atomic namespace from get/set
// — they exist precisely because a get+1+set over shared storage loses
// concurrent updates between the app and the widget extension.
describe("Storage counters", () => {
  it("adds and clamps through the in-memory fallback, returning the new value", () => {
    expect(Storage.counterValue("hydration.glasses")).toBe(0);
    expect(Storage.counterAdd("hydration.glasses", 1, 0, 8)).toBe(1);
    expect(Storage.counterAdd("hydration.glasses", 1, 0, 8)).toBe(2);
    expect(Storage.counterValue("hydration.glasses")).toBe(2);
    // Clamps at the ceiling, and a big negative delta resets to the floor
    // (how the demo's "Reset" works — no separate set op).
    expect(Storage.counterAdd("hydration.glasses", 99, 0, 8)).toBe(8);
    expect(Storage.counterAdd("hydration.glasses", -100, 0, 8)).toBe(0);
  });

  it("routes through the host counter bridge when available", () => {
    const host = installMockHost();
    expect(Storage.counterAdd("c", 3, 0, 10)).toBe(3);
    expect(host.counterAdd).toHaveBeenCalledWith("c", 3, 0, 10);
    expect(Storage.counterValue("c")).toBe(3);
  });

  it("is a distinct namespace from the JSON KV store", () => {
    // A counter and a same-named get/set value don't alias each other.
    Storage.set("x", 5);
    Storage.counterAdd("x", 2, 0, 99);
    expect(Storage.get<number>("x")).toBe(5);
    expect(Storage.counterValue("x")).toBe(2);
  });
});
