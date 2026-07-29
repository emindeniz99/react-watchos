import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invokeShapes } from "../codegen/schema";
import { INVOKE_SHAPES } from "../src/generated/wire";

/**
 * ARCH-11 follow-up: the native -> wire PRODUCER-key gate.
 *
 * `invoke-contract.test.ts` + `InvokeContractTests.swift` pin the RESPONSE half
 * from the consumer end — the schema shape is type-identical to the public TS
 * interface, and the fixture a wrapper resolves decodes as that shape. What
 * neither proves is that the SWIFT code which builds the JSON emits those key
 * names: every response is assembled by hand into a `[String: Any]` (the
 * generated Codables live in the test target only, by the decision recorded on
 * `invokeShapes`), so a renamed key there degrades to `undefined` on a watch
 * with every existing gate still green.
 *
 * This closes it the `codegen.test.ts` way — a textual scan of the real Swift
 * sources, so it runs on Linux against watchOS-only files that cannot be
 * compiled here. For each declared response shape we slice the producing
 * function out of its source file and extract the keys it writes (dictionary
 * literals + `dict["key"] =` subscript writes), then assert that key set
 * against the schema's declared fields in BOTH directions.
 */

const swiftRoot = join(__dirname, "../swift/Sources");

/** One function that assembles a response payload. */
interface EmitSite {
  /** Path under `swift/Sources`. */
  file: string;
  /** The function's declaration line, verbatim — the slice's start marker. */
  decl: string;
}

interface Producer {
  /** Where the keys are actually written. Several when one method resolves
   *  from more than one function; keys are unioned across them. */
  sites: EmitSite[];
  /** For a method whose invoke handler only delegates: the handler function
   *  and the call it must contain, so handler and producer can't drift apart
   *  (the scan would otherwise keep passing against an orphaned producer). */
  delegates?: { decl: string; calls: string };
  /** Declared fields the native producer legitimately never emits, keyed by
   *  the reason. Every entry is asserted to still be true below — an
   *  exception that rots fails instead of silently widening the gate. */
  neverEmitted?: string[];
}

const HOST = "ReactWatchHost/ReactWatchHost.swift";
const BRIDGES = "ReactWatchHost/CapabilityBridges.swift";
const CONNECTIVITY = "ReactWatchHost/PhoneConnectivity.swift";
const HEALTH = "ReactWatchHost/HealthQueryBridge.swift";
const WORKOUT = "ReactWatchHost/WorkoutBridge.swift";
// The pedometer payload is assembled in ReactWatchSupport, not the watchOS
// bridge: that makes the omit-when-unavailable rule Linux-testable AND puts
// this scan on a file `swift test` actually compiles.
const PEDOMETER = "ReactWatchSupport/PedometerReading.swift";

/** Every `via:"invoke"` method the schema gives a `response` shape, and the
 *  Swift function(s) that build that response's JSON. */
const PRODUCERS: Record<string, Producer> = {
  getUpdateState: {
    sites: [
      { file: HOST, decl: "private func handleGetUpdateState(id: Int) {" },
    ],
    // `releaseId` is the one UpdateState field the host does not know: it is
    // the running bundle's content id, merged in JS by getUpdateState() from
    // the host-injected `__bundleReleaseId` global (js/src/update.ts). The
    // assertion below pins that merge, so dropping it turns this into a gap.
    neverEmitted: ["releaseId"],
  },
  getDeviceInfo: {
    sites: [
      { file: BRIDGES, decl: "static func current() -> [String: Any] {" },
    ],
    delegates: {
      decl: "func handleGetDeviceInfo(id: Int) {",
      calls: "DeviceSnapshot.current()",
    },
  },
  saveUpdate: {
    sites: [
      {
        file: HOST,
        decl: "private func handleSaveUpdate(id: Int, payload: String) {",
      },
    ],
  },
  getProducts: {
    sites: [
      {
        file: BRIDGES,
        decl: "static func products(for ids: [String]) async -> Result {",
      },
    ],
    delegates: {
      decl: "func handleGetProducts(id: Int, payload: String) {",
      calls: "StoreKitBridge.products(for: ids)",
    },
  },
  purchase: {
    sites: [
      {
        file: BRIDGES,
        decl: "static func purchase(productId: String) async -> Result {",
      },
    ],
    delegates: {
      decl: "func handlePurchase(id: Int, payload: String) {",
      calls: "StoreKitBridge.purchase(productId: productId)",
    },
  },
  searchPOI: {
    sites: [
      {
        file: HOST,
        decl: "private func handleSearchPOI(id: Int, payload: String) {",
      },
    ],
  },
  getCurrentLocation: {
    sites: [
      { file: HOST, decl: "private func handleGetCurrentLocation(id: Int) {" },
    ],
  },
  queryHealthStatistics: {
    sites: [
      {
        file: HEALTH,
        decl: "func statistics(_ plan: HealthStatisticsPlan) async -> Outcome {",
      },
    ],
    delegates: {
      decl: "private func handleQueryHealthStatistics(id: Int, payload: String) {",
      calls: "bridge.statistics(plan)",
    },
  },
  queryHealthSamples: {
    sites: [
      {
        file: HEALTH,
        decl: "func samples(_ plan: HealthSamplesPlan) async -> Outcome {",
      },
    ],
    delegates: {
      decl: "private func handleQueryHealthSamples(id: Int, payload: String) {",
      calls: "bridge.samples(plan)",
    },
  },
  endWorkout: {
    sites: [
      { file: WORKOUT, decl: "func stateSnapshot() -> [String: Any] {" },
      { file: WORKOUT, decl: "    private func recordEnded(" },
    ],
    delegates: {
      decl: "private func handleEndWorkout(id: Int, payload: String) {",
      calls: "workout.endWorkout(discard: discard)",
    },
  },
  getWorkoutState: {
    sites: [
      { file: WORKOUT, decl: "func stateSnapshot() -> [String: Any] {" },
      { file: WORKOUT, decl: "    private func recordEnded(" },
    ],
    delegates: {
      decl: "private func handleGetWorkoutState(id: Int) {",
      calls: "workout.stateSnapshot()",
    },
  },
  queryPedometer: {
    sites: [
      { file: PEDOMETER, decl: "public func payload() -> [String: Any] {" },
    ],
    delegates: {
      decl: "private func handleQueryPedometer(id: Int, payload: String) {",
      calls: "sensors.pedometer.query(plan)",
    },
  },
  transferFile: {
    sites: [
      {
        file: HOST,
        decl: "private func handleTransferFile(id: Int, payload: String) {",
      },
    ],
  },
  outstandingFileTransfers: {
    sites: [
      {
        file: CONNECTIVITY,
        decl: "func outstandingTransfers() -> [[String: Any]] {",
      },
    ],
    delegates: {
      decl: "private func handleOutstandingFileTransfers(id: Int) {",
      calls: "connectivity.outstandingTransfers()",
    },
  },
  getConnectivityState: {
    sites: [
      {
        file: CONNECTIVITY,
        decl: "func connectivityState() -> [String: Any] {",
      },
    ],
    delegates: {
      decl: "private func handleGetConnectivityState(id: Int) {",
      calls: "connectivity.connectivityState()",
    },
  },
  querySleepSamples: {
    sites: [
      {
        file: HEALTH,
        decl: "func sleepSamples(_ plan: SleepSamplesPlan) async -> Outcome {",
      },
    ],
    delegates: {
      decl: "private func handleQuerySleepSamples(id: Int, payload: String) {",
      calls: "bridge.sleepSamples(plan)",
    },
  },
};

function readSwift(file: string): string {
  return readFileSync(join(swiftRoot, file), "utf8");
}

/**
 * The body of one Swift function: from its declaration line to the first line
 * that closes at the declaration's own indentation. Every function scanned here
 * sits at four-space indentation (a type member), and deeper closers (`        }`)
 * therefore can't end the slice early.
 */
function functionBody(src: string, decl: string): string {
  const start = src.indexOf(decl);
  expect(start, `no Swift function declared \`${decl}\``).toBeGreaterThan(-1);
  const end = src.indexOf("\n    }\n", start);
  expect(end, `\`${decl}\` never closes at member indentation`).toBeGreaterThan(
    -1,
  );
  return src.slice(start, end);
}

/** A dictionary key literal: `"name":` opening an entry — i.e. preceded by the
 *  literal's `[`/`{`, an argument list's `(`, or a preceding entry's `,`.
 *  Anchoring on the predecessor is what keeps a ternary's `? "left" : "right"`
 *  (whose branch also reads as `"word":`) out of the key set. */
const DICT_KEY = /[[{(,]\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g;
/** A later conditional write: `result["version"] = version`. Reads (`obj["x"]
 *  as? String`) have no `=` and are not keys the producer emits. */
const SUBSCRIPT_WRITE = /\w\[\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\]\s*=/g;

function emittedKeys(body: string): Set<string> {
  // Comment lines can contain anything that looks like a key; the producers
  // here are heavily commented, so drop them before scanning.
  const code = body
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  const keys = new Set<string>();
  for (const m of code.matchAll(DICT_KEY)) keys.add(m[1] as string);
  for (const m of code.matchAll(SUBSCRIPT_WRITE)) keys.add(m[1] as string);
  return keys;
}

/** The schema fields of a response shape, by its `ts` name (`Foo[]` = a list
 *  of `Foo`, which has the same per-element shape). */
function declaredFields(responseType: string): {
  required: string[];
  all: string[];
} {
  const name = responseType.replace(/\[\]$/, "");
  const shape = invokeShapes.find((s) => s.ts === name);
  expect(shape, `no invokeShapes entry named ${name}`).toBeDefined();
  const fields = (shape as { fields: { name: string; optional?: boolean }[] })
    .fields;
  return {
    required: fields.filter((f) => !f.optional).map((f) => f.name),
    all: fields.map((f) => f.name),
  };
}

describe("native response producers emit exactly the declared keys", () => {
  it("scans a producer for every response shape the schema declares", () => {
    // Drives off the generated table: adding a `response` to a schema method
    // without pointing this file at the Swift that builds it fails here, so a
    // new native producer can't ship un-gated.
    const declared = Object.entries(INVOKE_SHAPES)
      .filter(([, shape]) => "response" in shape)
      .map(([method]) => method)
      .sort();
    expect(Object.keys(PRODUCERS).sort()).toEqual(declared);
  });

  for (const [method, producer] of Object.entries(PRODUCERS)) {
    it(`${method}'s Swift producer matches its response shape`, () => {
      const shape = INVOKE_SHAPES[method as keyof typeof INVOKE_SHAPES] as {
        response: string;
      };
      const { required, all } = declaredFields(shape.response);
      const emitted = new Set<string>();
      for (const site of producer.sites) {
        const body = functionBody(readSwift(site.file), site.decl);
        for (const key of emittedKeys(body)) emitted.add(key);
      }

      // (1) Nothing undeclared: a key the schema has never heard of is a
      //     field JS silently ignores — the rename half of the bug.
      expect(
        [...emitted].filter((k) => !all.includes(k)).sort(),
        `${method} emits keys no response field declares`,
      ).toEqual([]);

      // (2) Nothing dropped: every field the shape declares is emitted
      //     somewhere, except the recorded exceptions.
      const exceptions = producer.neverEmitted ?? [];
      expect(
        all.filter((f) => !emitted.has(f) && !exceptions.includes(f)).sort(),
        `${method}'s producer no longer emits these declared fields`,
      ).toEqual([]);

      // (3) Required fields specifically — restated so a field that moves from
      //     required to optional can't quietly inherit an exception.
      expect(
        required.filter((f) => !emitted.has(f)).sort(),
        `${method}'s producer drops a REQUIRED field`,
      ).toEqual([]);

      // (4) An exception must still be an exception: a field listed as
      //     never-emitted that the producer now DOES emit is stale bookkeeping.
      expect(
        exceptions.filter((f) => emitted.has(f)),
        `${method} now emits a field recorded as never-emitted`,
      ).toEqual([]);
    });
  }

  it("keeps each delegating invoke handler wired to its producer", () => {
    // The scanned producer is only the truth if the handler still calls it.
    const host = readSwift(HOST);
    for (const [method, producer] of Object.entries(PRODUCERS)) {
      if (!producer.delegates) continue;
      const body = functionBody(host, producer.delegates.decl);
      expect(
        body,
        `${method}'s handler no longer calls its producer`,
      ).toContain(producer.delegates.calls);
    }
  });

  it("keeps UpdateState.releaseId's JS-side merge (the one exception)", () => {
    // getUpdateState's `neverEmitted` is only honest while JS still supplies
    // the field. If this merge goes, `releaseId` becomes undefined everywhere
    // and the exception above would be hiding it.
    const update = readFileSync(join(__dirname, "../src/update.ts"), "utf8");
    expect(update).toContain("state.releaseId = releaseId");
  });
});
