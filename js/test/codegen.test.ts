import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostMethods } from "../codegen/schema.mjs";

const jsRoot = join(__dirname, "..");
const swiftRoot = join(jsRoot, "swift");

describe("codegen", () => {
  it("committed generated files are up to date (no drift)", () => {
    // Exits non-zero and prints which file is stale if `npm run codegen`
    // would change anything — the single-source-of-truth guarantee.
    expect(() =>
      execFileSync("node", [join(jsRoot, "codegen/generate.mjs"), "--check"], {
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("the generated install table covers exactly the schema's direct host methods", () => {
    // The host bridge is generated (CX-023): the install table lives in the
    // generated HostBridge.swift, so it must install every DIRECT host method the
    // schema declares. `via:"invoke"` methods are routed through the generic
    // invoke channel, not installed as their own host functions (SD-1), so
    // they're excluded. This guards the GENERATOR's output (the drift test guards
    // that the committed file matches; HostBridgeTests.swift proves each works).
    const src = readFileSync(
      join(swiftRoot, "Sources/ReactWatchRuntime/Generated/HostBridge.swift"),
      "utf8",
    );
    const installed = new Set<string>();
    for (const m of src.matchAll(
      /JS_SetPropertyStr\(\s*\w+,\s*host,\s*"(\w+)"/g,
    )) {
      installed.add(m[1] as string);
    }
    const expected = new Set(
      hostMethods.filter((m) => m.via !== "invoke").map((m) => m.name),
    );
    expect([...installed].sort()).toEqual([...expected].sort());
  });

  it("the host routes exactly the schema's invoke methods", () => {
    // Each `via:"invoke"` method must have a routing case in ReactWatchHost's
    // onInvoke dispatcher, so the schema and the native router can't drift.
    const src = readFileSync(
      join(swiftRoot, "Sources/ReactWatchHost/ReactWatchHost.swift"),
      "utf8",
    );
    // Scope the case scan to the handleInvoke dispatcher (from the func to the
    // first `default:` that closes its switch) so string cases in unrelated
    // switches — haptic direction, notification-action, StoreKit outcome — don't
    // leak into the reverse check below.
    const dispatchStart = src.indexOf("func handleInvoke(");
    const dispatch = src.slice(
      dispatchStart,
      src.indexOf("default:", dispatchStart),
    );
    const routed = new Set<string>();
    for (const m of dispatch.matchAll(/case\s+"(\w+)"\s*:/g)) {
      routed.add(m[1] as string);
    }
    const invokeMethods = hostMethods.filter((m) => m.via === "invoke");
    // Forward: every schema invoke method has a routing case.
    for (const m of invokeMethods) {
      expect(routed.has(m.name)).toBe(true);
    }
    // Reverse: every routing case is a declared schema invoke method — so a
    // hand-written Swift `case "foo"` with no schema entry (the enableWaterLock
    // gap) fails here instead of silently rejecting with UNKNOWN_METHOD at
    // runtime.
    const declared = new Set(invokeMethods.map((m) => m.name));
    for (const name of routed) {
      expect(declared.has(name)).toBe(true);
    }
  });
});
