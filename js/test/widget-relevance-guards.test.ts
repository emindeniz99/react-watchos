import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  FitnessCondition,
  HeadphonesCondition,
  InferredLocation,
  PoiCategory,
  RelevantContext,
  RelevantDateKind,
  SleepCondition,
} from "../src/widgets";

/**
 * Cross-language guards for the Smart Stack relevance VOCABULARIES — the
 * string enums the tagged union carries (`kind`, `dateKind`, POI categories,
 * inferred places, the three condition families).
 *
 * THE HAZARD: `reactRelevantContext(from:)` and `reactPoiCategory(_:)` are
 * hand-mirrored switches inside `#if os(watchOS)`, so no Linux job compiles
 * them, and every unmapped name is DROPPED BY DESIGN (forward-compat for a
 * bundle newer than the binary). That policy is right for a genuinely newer
 * bundle and
 * catastrophic for a typo: a TS union member with no Swift case type-checks,
 * lints, passes every JS test, and then silently never surfaces the widget —
 * the exact failure mode `health-package-guards.test.ts` pins for the sensor
 * switch. The wire STRUCTURE is already pinned in Swift
 * (`PublishedRelevantContextTests` + its Mirror field check); these guards pin
 * the VALUES.
 *
 * Each family uses the `Record<Union, true>` idiom so the TS half is a
 * compile-time gate (a union member added without updating the Record fails
 * `tsc`), and the Swift half is a textual scan (weaker than a compile,
 * stronger than the nothing these names had).
 */

const timelineSwift = readFileSync(
  join(__dirname, "../swift/Sources/ReactWatchWidget/ReactTimeline.swift"),
  "utf8",
);

/** The source slice for one function, so nested switches (which reuse
 *  spellings like "school" in both `inferredLocation` and `poi`) can't
 *  satisfy another family's scan. */
function slice(from: string, to: string): string {
  const start = timelineSwift.indexOf(from);
  const end = timelineSwift.indexOf(to);
  expect(start, `marker not found: ${from}`).toBeGreaterThanOrEqual(0);
  expect(end, `marker not found: ${to}`).toBeGreaterThan(start);
  return timelineSwift.slice(start, end);
}

const contextSwitch = slice(
  "public func reactRelevantContext",
  "private func reactRelevantDateKind",
);
const dateKindSwitch = slice(
  "private func reactRelevantDateKind",
  "private func reactPoiCategory",
);
const poiSwitch = slice("private func reactPoiCategory", "func reactEntry");

/** `case "name": .member` / `case "name": return …(.member)` pairs. */
function casePairs(src: string, pattern: RegExp): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const m of src.matchAll(pattern)) {
    pairs.set(m[1] as string, m[2] as string);
  }
  return pairs;
}

describe("the clue-family discriminants cannot half-widen", () => {
  // Both-directions gate: a ninth arm added to `RelevantContext` without a row
  // here fails to compile; the scan below then requires its Swift case.
  const ALL_KINDS: Record<RelevantContext["kind"], true> = {
    date: true,
    dateRange: true,
    location: true,
    poi: true,
    inferredLocation: true,
    fitness: true,
    sleep: true,
    headphones: true,
  };

  it("reactRelevantContext(from:) has an arm per TS kind and none extra", () => {
    // Top-level arms of the `switch ctx.kind` sit at 4-space indent with the
    // body on the following lines; the nested condition switches are one level
    // deeper with inline bodies, so this anchored match sees only the kinds.
    const swiftKinds = [...contextSwitch.matchAll(/^ {4}case "(\w+)":$/gm)].map(
      (m) => m[1] as string,
    );
    expect(swiftKinds.sort()).toEqual(Object.keys(ALL_KINDS).sort());
  });
});

describe("the POI category vocabulary cannot half-widen", () => {
  // 73 members, mirrored BY MEMBER NAME (`MKPointOfInterestCategory`'s
  // rawValue is an undocumented ObjC constant). MapKit's 11 watchOS-27-beta
  // additions are deliberately absent on BOTH sides (the CX-002 rule).
  const ALL_POI: Record<PoiCategory, true> = {
    museum: true,
    musicVenue: true,
    theater: true,
    library: true,
    planetarium: true,
    school: true,
    university: true,
    movieTheater: true,
    nightlife: true,
    fireStation: true,
    hospital: true,
    pharmacy: true,
    police: true,
    castle: true,
    fortress: true,
    landmark: true,
    nationalMonument: true,
    bakery: true,
    brewery: true,
    cafe: true,
    distillery: true,
    foodMarket: true,
    restaurant: true,
    winery: true,
    animalService: true,
    atm: true,
    automotiveRepair: true,
    bank: true,
    beauty: true,
    evCharger: true,
    fitnessCenter: true,
    laundry: true,
    mailbox: true,
    postOffice: true,
    restroom: true,
    spa: true,
    store: true,
    amusementPark: true,
    aquarium: true,
    beach: true,
    campground: true,
    fairground: true,
    marina: true,
    nationalPark: true,
    park: true,
    rvPark: true,
    zoo: true,
    baseball: true,
    basketball: true,
    bowling: true,
    goKart: true,
    golf: true,
    hiking: true,
    miniGolf: true,
    rockClimbing: true,
    skatePark: true,
    skating: true,
    skiing: true,
    soccer: true,
    stadium: true,
    tennis: true,
    volleyball: true,
    airport: true,
    carRental: true,
    conventionCenter: true,
    gasStation: true,
    hotel: true,
    parking: true,
    publicTransport: true,
    fishing: true,
    kayaking: true,
    surfing: true,
    swimming: true,
  };

  it("reactPoiCategory maps every TS name to the SAME-NAMED member", () => {
    const pairs = casePairs(poiSwitch, /case "(\w+)": \.(\w+)/g);
    expect([...pairs.keys()].sort()).toEqual(Object.keys(ALL_POI).sort());
    // Same-named, not just same-counted: `case "cafe": .restaurant` would pass
    // a set check and silently surface the widget at the wrong places.
    for (const [wire, member] of pairs) {
      expect(member, `case "${wire}" maps to .${member}`).toBe(wire);
    }
  });
});

describe("the small vocabularies cannot half-widen", () => {
  const ALL_DATE_KINDS: Record<RelevantDateKind, true> = {
    default: true,
    informational: true,
    scheduled: true,
  };
  const ALL_PLACES: Record<InferredLocation, true> = {
    home: true,
    work: true,
    school: true,
    commute: true,
  };
  const ALL_FITNESS: Record<FitnessCondition, true> = {
    activityRingsIncomplete: true,
    workoutActive: true,
  };
  const ALL_SLEEP: Record<SleepCondition, true> = {
    bedtime: true,
    wakeup: true,
  };
  const ALL_HEADPHONES: Record<HeadphonesCondition, true> = {
    connected: true,
  };

  function expectSameNamed(
    pairs: Map<string, string>,
    declared: Record<string, true>,
  ) {
    expect([...pairs.keys()].sort()).toEqual(Object.keys(declared).sort());
    for (const [wire, member] of pairs) {
      expect(member, `case "${wire}" maps to .${member}`).toBe(wire);
    }
  }

  it("DateKind", () => {
    expectSameNamed(
      casePairs(dateKindSwitch, /case "(\w+)": \.(\w+)/g),
      ALL_DATE_KINDS,
    );
  });

  it("InferredLocation", () => {
    expectSameNamed(
      casePairs(
        contextSwitch,
        /case "(\w+)": return \.location\(inferred: \.(\w+)\)/g,
      ),
      ALL_PLACES,
    );
  });

  it("FitnessCondition", () => {
    expectSameNamed(
      casePairs(contextSwitch, /case "(\w+)": return \.fitness\(\.(\w+)\)/g),
      ALL_FITNESS,
    );
  });

  it("SleepCondition", () => {
    expectSameNamed(
      casePairs(contextSwitch, /case "(\w+)": return \.sleep\(\.(\w+)\)/g),
      ALL_SLEEP,
    );
  });

  it("HeadphonesCondition", () => {
    expectSameNamed(
      casePairs(
        contextSwitch,
        /case "(\w+)": return \.hardware\(headphones: \.(\w+)\)/g,
      ),
      ALL_HEADPHONES,
    );
  });
});

describe("the geofence radius default is one number", () => {
  it("Swift applies 100 m and the JS API documents the same value", () => {
    // Two spellings of one promise: the JSDoc tells the author what an
    // omitted radius means, the Swift `??` is what actually happens. Pin both
    // so neither can move alone.
    expect(contextSwitch).toContain("radius: ctx.radius ?? 100");
    const widgetsTs = readFileSync(
      join(__dirname, "../src/widgets.ts"),
      "utf8",
    );
    expect(widgetsTs).toContain("default 100");
  });
});
