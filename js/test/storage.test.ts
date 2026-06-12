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
