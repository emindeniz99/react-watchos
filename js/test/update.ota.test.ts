import { afterEach, describe, expect, it } from "vitest";
import { applyUpdate } from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__host;
});

describe("OTA applyUpdate", () => {
  it("forwards the bundle to the host as a JSON payload", () => {
    const host = installMockHost();
    applyUpdate("globalThis.x = 1;");
    expect(host.saveUpdate).toHaveBeenCalledWith(
      JSON.stringify({ js: "globalThis.x = 1;" }),
    );
  });

  it("carries the Ed25519 signature when provided (CR-4)", () => {
    const host = installMockHost();
    applyUpdate("globalThis.x = 1;", "c2lnbmF0dXJl");
    expect(host.saveUpdate).toHaveBeenCalledWith(
      JSON.stringify({ js: "globalThis.x = 1;", signature: "c2lnbmF0dXJl" }),
    );
  });

  it("is a no-op without an update-capable host", () => {
    expect(() => applyUpdate("x")).not.toThrow();
  });
});
