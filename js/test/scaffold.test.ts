import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// DX-3: the scaffolder's pure template logic (CommonJS, loaded by the CLI).
const require = createRequire(import.meta.url);
const { structName, widgetStructName, watchAppSwift, widgetBundleSwift } =
  require("../plugin/scaffold.cts");

describe("scaffold (DX-3)", () => {
  it("derives a valid Swift struct name from the target name", () => {
    expect(structName("React Watch")).toBe("ReactWatchApp");
    expect(structName("Expo Watch")).toBe("ExpoWatchApp");
    // Non-identifier chars are stripped; an empty name falls back.
    expect(structName("My-Watch 2!")).toBe("MyWatch2App");
    expect(structName("")).toBe("ReactWatchApp");
    // A leading digit is invalid at the head of a Swift identifier, so it's
    // prefixed rather than emitted as an uncompilable `2WatchApp`.
    expect(structName("2 Watch")).toBe("App2WatchApp");
    expect(widgetStructName("2 Watch")).toBe("App2WatchWidgets");
  });

  it("generates a compilable @main App embedding ReactWatchRootView", () => {
    const src = watchAppSwift({
      name: "Expo Watch",
      appGroupId: "group.com.example.expowatch",
    });
    expect(src).toContain("import ReactWatchHost");
    expect(src).toContain("@main");
    expect(src).toContain("struct ExpoWatchApp: App {");
    // Background-refresh delivery is wired by default (harmless if unused).
    expect(src).toContain(
      "@WKApplicationDelegateAdaptor(ReactWatchAppDelegate.self)",
    );
    // The App Group must be threaded into ReactWatchRootView verbatim.
    expect(src).toContain(
      'ReactWatchRootView(appGroupId: "group.com.example.expowatch")',
    );
  });

  it("derives the widget bundle struct name from the target name", () => {
    expect(widgetStructName("React Watch")).toBe("ReactWatchWidgets");
    expect(widgetStructName("Expo Watch")).toBe("ExpoWatchWidgets");
    expect(widgetStructName("")).toBe("ReactWatchWidgets");
  });

  it("generates a @main WidgetBundle that consumes ReactWatchWidget", () => {
    const src = widgetBundleSwift({
      name: "Expo Watch",
      appGroupId: "group.com.example.expowatch",
    });
    expect(src).toContain("import ReactWatchWidget");
    expect(src).toContain("@main");
    expect(src).toContain("struct ExpoWatchWidgets: WidgetBundle {");
    // Renders through the package provider/view, threading the App Group.
    expect(src).toContain(
      'ReactTimelineProvider(kind: kind, appGroupId: "group.com.example.expowatch")',
    );
    expect(src).toContain(
      'reactWidgetView(entry, appGroupId: "group.com.example.expowatch")',
    );
  });
});

// The CLI writes the watch glue first and used to exit the moment it found
// that file already there — so re-running `scaffold` after turning the widget
// target on (the ordinary way a widget gets added to an existing app) never
// produced targets/widget/ReactWidgets.swift. Each glue file has to stand on
// its own: an existing one is refused, the missing one is still written.
describe("scaffold CLI", () => {
  it("writes the widget glue even when the watch glue already exists", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "rnw-scaffold-"));
    writeFileSync(
      join(projectRoot, "app.json"),
      JSON.stringify({
        expo: {
          name: "Example",
          ios: { bundleIdentifier: "com.example.app" },
          plugins: [["react-watchos", { widget: true }]],
        },
      }),
    );
    const watchGlue = join(projectRoot, "targets/watch/WatchApp.swift");
    mkdirSync(dirname(watchGlue), { recursive: true });
    writeFileSync(watchGlue, "// hand-edited\n");

    const run = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../bin/react-watchos.cts",
        ),
        "scaffold",
      ],
      { cwd: projectRoot, encoding: "utf8" },
    );
    // The refusal is still a failure — nothing silently skipped…
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("targets/watch/WatchApp.swift already exists");
    // …but it no longer takes the widget glue down with it.
    expect(
      existsSync(join(projectRoot, "targets/widget/ReactWidgets.swift")),
    ).toBe(true);
    expect(run.stdout).toContain("wrote targets/widget/ReactWidgets.swift");
  });
});
