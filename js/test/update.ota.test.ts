import { afterEach, describe, expect, it } from "vitest";
import { applyUpdate } from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__host;
});

describe("OTA applyUpdate", () => {
  it("forwards the bundle to the host to persist", () => {
    const host = installMockHost();
    applyUpdate("globalThis.x = 1;");
    expect(host.saveUpdate).toHaveBeenCalledWith("globalThis.x = 1;");
  });

  it("is a no-op without an update-capable host", () => {
    expect(() => applyUpdate("x")).not.toThrow();
  });
});
