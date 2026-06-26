import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// DX-3: the scaffolder's pure template logic (CommonJS, loaded by the CLI).
const require = createRequire(import.meta.url);
const { structName, watchAppSwift } = require("../plugin/scaffold.cjs");

describe("scaffold (DX-3)", () => {
  it("derives a valid Swift struct name from the target name", () => {
    expect(structName("React Watch")).toBe("ReactWatchApp");
    expect(structName("Expo Watch")).toBe("ExpoWatchApp");
    // Non-identifier chars are stripped; an empty name falls back.
    expect(structName("My-Watch 2!")).toBe("MyWatch2App");
    expect(structName("")).toBe("ReactWatchApp");
  });

  it("generates a compilable @main App embedding ReactWatchRootView", () => {
    const src = watchAppSwift({
      name: "Expo Watch",
      appGroupId: "group.com.example.expowatch",
    });
    expect(src).toContain("import ReactWatchHost");
    expect(src).toContain("@main");
    expect(src).toContain("struct ExpoWatchApp: App {");
    // The App Group must be threaded into ReactWatchRootView verbatim.
    expect(src).toContain(
      'ReactWatchRootView(appGroupId: "group.com.example.expowatch")',
    );
  });
});
