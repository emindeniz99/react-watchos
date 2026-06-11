import { afterEach, describe, expect, it, vi } from "vitest";
import { Storage } from "../src/index";

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

  it("uses the host storage bridge when available", () => {
    const backing = new Map<string, string>();
    (globalThis as Record<string, unknown>).__host = {
      commit: vi.fn(),
      log: vi.fn(),
      setTimer: vi.fn(),
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => backing.set(key, value),
    };

    Storage.set("glasses", 5);
    expect(backing.get("glasses")).toBe("5");
    expect(Storage.get<number>("glasses")).toBe(5);
  });

  it("returns null for corrupt stored JSON instead of throwing", () => {
    (globalThis as Record<string, unknown>).__host = {
      commit: vi.fn(),
      log: vi.fn(),
      setTimer: vi.fn(),
      getItem: () => "{not json",
      setItem: vi.fn(),
    };
    expect(Storage.get("anything")).toBeNull();
  });
});
