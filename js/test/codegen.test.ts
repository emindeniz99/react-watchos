import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  healthQuantityTypes,
  hostMethods,
  invokeShapes,
  workoutActivityTypes,
} from "../codegen/schema";

const jsRoot = join(__dirname, "..");
const swiftRoot = join(jsRoot, "swift");

/** The `case foo` names of one Swift enum, in declaration order. */
function swiftEnumCases(src: string, declaration: string): string[] {
  const start = src.indexOf(declaration);
  expect(start, `no Swift enum declared \`${declaration}\``).toBeGreaterThan(
    -1,
  );
  const body = src.slice(start, src.indexOf("\n}\n", start));
  return [...body.matchAll(/^ {4}case (\w+)$/gm)].map((m) => m[1] as string);
}

/** The members of a closed union declared inline on a schema field, e.g.
 *  `'"sum" | "average"'` -> `["sum", "average"]`. */
function schemaUnion(shape: string, field: string): string[] {
  const def = invokeShapes.find((s) => s.ts === shape);
  expect(def, `no invokeShapes entry named ${shape}`).toBeDefined();
  const declared = def?.fields.find((f) => f.name === field);
  expect(declared, `${shape} has no field ${field}`).toBeDefined();
  return [...(declared?.ts ?? "").matchAll(/"([^"]+)"/g)].map(
    (m) => m[1] as string,
  );
}

describe("codegen", () => {
  it("committed generated files are up to date (no drift)", () => {
    // Exits non-zero and prints which file is stale if `npm run codegen`
    // would change anything — the single-source-of-truth guarantee.
    expect(() =>
      // process.execPath = the same Node running vitest. The generator is .ts;
      // --experimental-strip-types runs it on any Node >= 22.6 (a no-op on 24+,
      // where stripping is the default) — so this passes whether vitest runs
      // under the project's pinned Node 24 or an older local Node.
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          join(jsRoot, "codegen/generate.ts"),
          "--check",
        ],
        { stdio: "pipe" },
      ),
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

  it("wraps every non-core feature's installs in a policy guard", () => {
    // ARCH-07: the generated install table gates each non-"core" feature's
    // host functions behind `allows("<feature>")` so a HostPolicy allowlist
    // actually controls what lands on `__host`. "core" (commit/log/timers/
    // invoke) must stay unconditional — a policy can't brick the runtime.
    const src = readFileSync(
      join(swiftRoot, "Sources/ReactWatchRuntime/Generated/HostBridge.swift"),
      "utf8",
    );
    const nonCoreFeatures = new Set(
      hostMethods
        .filter((m) => m.via !== "invoke" && m.feature !== "core")
        .map((m) => m.feature),
    );
    for (const feature of nonCoreFeatures) {
      expect(src).toContain(`if allows("${feature}") {`);
    }
    expect(src).not.toContain('allows("core")');
    // Every direct core method installs outside any guard: its install line
    // must appear before the first `allows(` guard opens.
    const firstGuard = src.indexOf("if allows(");
    for (const m of hostMethods.filter(
      (m) => m.via !== "invoke" && m.feature === "core",
    )) {
      const install = src.indexOf(`host, "${m.name}"`);
      expect(install).toBeGreaterThan(-1);
      expect(install).toBeLessThan(firstGuard);
    }
  });

  it("the generated invoke feature map matches the schema's invoke methods", () => {
    // ARCH-07: via:"invoke" methods aren't installed as host functions, so the
    // install guards can't gate them — the host's invoke dispatcher checks
    // HostInvokeFeatures.byMethod instead. It must list exactly the schema's
    // invoke methods with their features.
    const src = readFileSync(
      join(swiftRoot, "Sources/ReactWatchCore/WireModel.swift"),
      "utf8",
    );
    const block = src.slice(src.indexOf("public enum HostInvokeFeatures"));
    const mapped = new Map<string, string>();
    for (const m of block.matchAll(/"(\w+)":\s*"(\w+)"/g)) {
      mapped.set(m[1] as string, m[2] as string);
    }
    const invokeMethods = hostMethods.filter((m) => m.via === "invoke");
    expect(mapped.size).toBe(invokeMethods.length);
    for (const m of invokeMethods) {
      expect(mapped.get(m.name)).toBe(m.feature);
    }
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

// The health vocabularies live in TWO places by necessity: the schema renders
// the TS unions a caller is type-checked against, and ReactWatchSupport holds
// the Swift enums that carry the per-type unit + the statistics legality rule.
// Neither can be generated from the other (the Swift side is behavior, not a
// name list), so they are pinned against each other here — the same textual
// technique as the invoke-router check, and for the same reason: a divergence
// would surface as a request that type-checks in JS and rejects on a watch.
// HKWorkoutActivityType is an ObjC NS_ENUM whose UInt raw values Apple does
// not document, so JS sends the case NAME and Swift resolves it with a
// generated switch. Both halves come from `workoutActivityTypes`, which is
// what makes name-vs-case drift impossible — this proves the generator
// actually emitted every one, in a file no Linux build compiles.
describe("workout activity names", () => {
  const generated = readFileSync(
    join(
      swiftRoot,
      "Sources/ReactWatchHost/Generated/WorkoutActivityName.swift",
    ),
    "utf8",
  );

  it("maps exactly the schema's activity types, name to case", () => {
    const mapped = [...generated.matchAll(/case "(\w+)": \.(\w+)$/gm)];
    expect(mapped.map((m) => m[1])).toEqual(workoutActivityTypes);
    // Name and case must be the SAME identifier: a `case "running": .rowing`
    // typo would compile and silently record the wrong activity.
    expect(mapped.filter((m) => m[1] !== m[2])).toEqual([]);
  });

  it("reads the same table backwards for a recovered session", () => {
    // The one session this process does not build from a wire payload: a
    // workout recovered after a crash arrives as an HKWorkoutActivityType
    // case, and `getWorkoutState()` cannot report it until it is named. Both
    // directions come from the same list, so a one-way edit is impossible —
    // and the case/name identity check catches the `.rowing -> "running"`
    // transposition a hand-written reverse table invites.
    const reverse = generated.slice(
      generated.indexOf("static func name(for type:"),
    );
    const mapped = [...reverse.matchAll(/case \.(\w+): "(\w+)"$/gm)];
    expect(mapped.map((m) => m[2])).toEqual(workoutActivityTypes);
    expect(mapped.filter((m) => m[1] !== m[2])).toEqual([]);
    // Same refusal posture as the forward direction: a case this vocabulary
    // excludes is unnamed, and the snapshot omits activityType rather than
    // reporting a workout the user never did.
    expect(reverse).toContain("default: nil");
  });

  it("keeps a nil default so an unknown name is refused, not defaulted", () => {
    // Falling back to `.other` would record a workout the user never did.
    expect(generated).toContain("default: nil");
  });

  it("excludes the three deprecated spellings", () => {
    // dance (deprecated watchOS 7.0), danceInspiredTraining (3.0) and
    // mixedMetabolicCardioTraining (4.0). Project rule 1 (pre-release, prefer
    // the clean shape) gives no compat argument for shipping them.
    for (const deprecated of [
      "dance",
      "danceInspiredTraining",
      "mixedMetabolicCardioTraining",
    ]) {
      expect(workoutActivityTypes).not.toContain(deprecated);
      expect(generated).not.toContain(`case "${deprecated}"`);
    }
  });
});

describe("health vocabularies match the Swift enums", () => {
  const support = readFileSync(
    join(swiftRoot, "Sources/ReactWatchSupport/HealthQueryPlan.swift"),
    "utf8",
  );

  it("HealthQuantityKind covers exactly the schema's read types", () => {
    expect(
      swiftEnumCases(
        support,
        "public enum HealthQuantityKind: String, CaseIterable, Sendable {",
      ),
    ).toEqual(healthQuantityTypes);
  });

  it("HealthStatistic covers exactly the schema's statistic union", () => {
    expect(
      swiftEnumCases(
        support,
        "public enum HealthStatistic: String, CaseIterable, Sendable {",
      ),
    ).toEqual(schemaUnion("HealthStatisticsRequest", "statistic"));
  });

  it("SleepStage covers exactly the schema's stage union", () => {
    expect(
      swiftEnumCases(
        support,
        "public enum SleepStage: String, CaseIterable, Sendable {",
      ),
    ).toEqual(schemaUnion("SleepSample", "stage"));
  });

  it("the workout state + end-reason unions match their Swift enums", () => {
    const workout = readFileSync(
      join(swiftRoot, "Sources/ReactWatchSupport/WorkoutPlan.swift"),
      "utf8",
    );
    expect(
      swiftEnumCases(
        workout,
        "public enum WorkoutStateName: String, CaseIterable, Sendable {",
      ),
    ).toEqual(schemaUnion("WorkoutState", "state"));
    expect(
      swiftEnumCases(
        workout,
        "public enum WorkoutEndReason: String, CaseIterable, Sendable {",
      ),
    ).toEqual(schemaUnion("WorkoutState", "endedReason"));
    expect(
      swiftEnumCases(
        workout,
        "public enum WorkoutLocation: String, CaseIterable, Sendable {",
      ),
    ).toEqual(schemaUnion("StartWorkoutRequest", "location"));
  });
});
