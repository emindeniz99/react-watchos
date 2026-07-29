import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { invokeShapes } from "../codegen/schema";
import { isOnDeviceAIAvailable } from "../src/ai";
import { playAudio } from "../src/audio";
import { scheduleBackgroundRefresh } from "../src/background";
import { bleConnect, bleSubscribe, bleWrite } from "../src/bluetooth";
import type { CalendarEvent, Reminder } from "../src/calendar";
import {
  getCalendarEvents,
  getReminders,
  requestCalendarAccess,
} from "../src/calendar";
import type {
  ConnectivityState,
  FileTransferHandle,
  FileTransferStatus,
  ReceivedFileChunk,
} from "../src/connectivity";
import {
  cancelFileTransfer,
  deleteReceivedFile,
  getConnectivityState,
  outstandingFileTransfers,
  readReceivedFile,
  sendToPhone,
  transferFile,
  transferUserInfo,
  updateApplicationContext,
} from "../src/connectivity";
import type { DeviceInfo } from "../src/device";
import { getDeviceInfo } from "../src/device";
import type {
  CalendarEvent as WireCalendarEvent,
  ConnectivityState as WireConnectivityState,
  Coordinate as WireCoordinate,
  DeviceInfo as WireDeviceInfo,
  FileTransferHandle as WireFileTransferHandle,
  FileTransferStatus as WireFileTransferStatus,
  HealthSample as WireHealthSample,
  HealthStatisticsResult as WireHealthStatisticsResult,
  IAPProduct as WireIAPProduct,
  PedometerData as WirePedometerData,
  POIResult as WirePOIResult,
  PurchaseResult as WirePurchaseResult,
  ReceivedFileChunk as WireReceivedFileChunk,
  Reminder as WireReminder,
  SaveUpdateResult as WireSaveUpdateResult,
  ScheduledWorkoutSummary as WireScheduledWorkoutSummary,
  SleepSample as WireSleepSample,
  UpdateState as WireUpdateState,
  WorkoutState as WireWorkoutState,
} from "../src/generated/wire";
import { INVOKE_SHAPES } from "../src/generated/wire";
import type {
  HealthSample,
  HealthStatisticsResult,
  SleepSample,
} from "../src/health";
import {
  queryHealthDailyStatistics,
  queryHealthSamples,
  queryHealthStatistics,
  querySleepSamples,
  requestHealthAuthorization,
} from "../src/health";
import type { IAPProduct, PurchaseResult } from "../src/iap";
import { getProducts, purchase } from "../src/iap";
import { Keychain } from "../src/keychain";
import type { Coordinate, POIResult } from "../src/maps";
import { getCurrentLocation, searchPOI } from "../src/maps";
import { scheduleNotification } from "../src/notifications";
import { queryPedometer } from "../src/sensors";
import { speak } from "../src/speech";
import type { SaveUpdateResult, UpdateState } from "../src/update";
import { applyUpdate, getUpdateState, markUpdateHealthy } from "../src/update";
import type { WorkoutState } from "../src/workout";
import { endWorkout, getWorkoutState, startWorkout } from "../src/workout";
import type {
  ScheduledWorkoutSummary,
  WorkoutPlanIntervalStep,
  WorkoutPlanSpec,
} from "../src/workoutPlans";
import {
  listScheduledWorkoutPlans,
  openWorkoutPlanInWorkoutApp,
  removeAllScheduledWorkoutPlans,
  removeScheduledWorkoutPlan,
  requestWorkoutPlanAuthorization,
  scheduleWorkoutPlan,
} from "../src/workoutPlans";

/**
 * ARCH-11: the invoke channel's shape contract, checked against REAL traffic
 * rather than hand-authored copies — the same pattern as
 * `contract-fixture.test.tsx` -> `WireContractTests.swift`, applied to SD-1.
 *
 * Each payload-carrying wrapper is driven through a mock host; the `payloadJson`
 * it ACTUALLY produced is written to `Fixtures/invoke-<method>-request.json`,
 * and the result it resolves to `Fixtures/invoke-<method>-response.json`.
 * `InvokeContractTests.swift` then decodes every one of them with the schema's
 * generated Swift struct (and the real `NotificationPlan`/`UpdatePlan` decoders
 * where a handler has one), so a wrapper that renames a payload field fails
 * `swift test` instead of surfacing as a silent default on a watch.
 *
 * What this does NOT prove, stated plainly: the 31 Swift handlers keep their own
 * hand-written decoders (see the `invokeShapes` doc for why the generated-Codable
 * migration was rejected), so nothing here forces a handler to read the field
 * names it declares. It proves the JS payload matches the SCHEMA and the schema
 * matches the public TS types — which is what closes the drift loop that had a
 * regression gate nowhere.
 */

const fixturesDir = join(__dirname, "../swift/Tests/ReactWatchTests/Fixtures");

/** Written this run, so the completeness assertions below can't be satisfied by
 *  a stale file left on disk from a method that has since been removed. */
const wroteRequest = new Set<string>();
const wroteResponse = new Set<string>();
/** Every request field any fixture written this run actually carried, per
 *  method — unioned across a method's variants. The field-coverage assertion
 *  below reads it. */
const requestFields = new Map<string, Set<string>>();

/** `variant` writes a SECOND fixture for the same method
 *  (`invoke-<method>--<variant>-request.json`); the Swift side decodes every
 *  variant it finds with that method's decoder, so the extra file is not
 *  inert. Used where one payload cannot exercise the whole declared shape. */
function writeFixture(
  method: string,
  kind: "request" | "response",
  json: string,
  variant?: string,
): void {
  mkdirSync(fixturesDir, { recursive: true });
  const stem = variant ? `${method}--${variant}` : method;
  writeFileSync(
    join(fixturesDir, `invoke-${stem}-${kind}.json`),
    `${JSON.stringify(JSON.parse(json), null, 2)}\n`,
  );
  (kind === "request" ? wroteRequest : wroteResponse).add(method);
  if (kind === "request") {
    const seen = requestFields.get(method) ?? new Set<string>();
    for (const key of Object.keys(JSON.parse(json) as object)) seen.add(key);
    requestFields.set(method, seen);
  }
}

/**
 * The canned native result for each shape-returning method — typed by the
 * PUBLIC interface a caller sees, so a field that drifts out of the schema
 * fails `tsc` here before it can be written as a fixture.
 */
const deviceInfo: DeviceInfo = {
  batteryLevel: 0.62,
  batteryState: "unplugged",
  wristLocation: "left",
  crownOrientation: "right",
  screenWidth: 184,
  screenHeight: 224,
  screenScale: 2,
  layoutDirection: "leftToRight",
  model: "Apple Watch",
  systemVersion: "11.2",
  name: "Ada's Watch",
  reduceMotion: false,
  voiceOverRunning: false,
  preferredContentSizeCategory: "UICTContentSizeCategoryL",
  locale: "de_DE",
  language: "de",
  is24Hour: true,
};
const updateState: UpdateState = {
  source: "ota",
  version: 7,
  keyId: "k1",
  expiresAt: 1_800_000_000,
  highWater: 7,
  healthSignal: "explicit",
  bootAttempts: 1,
};
const saveUpdateResult: SaveUpdateResult = {
  accepted: false,
  code: "rejected",
  message: "signature does not verify",
};
const products: IAPProduct[] = [
  {
    id: "com.example.pro",
    displayName: "Pro",
    description: "Everything unlocked",
    displayPrice: "$1.99",
    price: 1.99,
    type: "nonConsumable",
  },
];
const purchaseResult: PurchaseResult = {
  status: "success",
  productId: "com.example.pro",
  transactionId: "2000000123456789",
};
const poiResults: POIResult[] = [
  {
    lat: 41.0082,
    lon: 28.9784,
    title: "Blue Bottle Coffee",
    subtitle: "Fatih",
  },
  { lat: 41.0102, lon: 28.9801, title: "Kronotrop" },
];
const coordinate: Coordinate = { lat: 41.0082, lon: 28.9784 };
const healthStatistics: HealthStatisticsResult = {
  value: 8412,
  unit: "count",
  startMs: 1_768_396_800_000,
  endMs: 1_768_483_200_000,
};
// Two contiguous daily buckets, the second EMPTY — `value: null` is what a
// rest day looks like, and it has to ride a fixture or the Swift decoder never
// sees the one field a bucketed series adds beyond the scalar query's.
const healthDailyStatistics: HealthStatisticsResult[] = [
  {
    value: 8412,
    unit: "count",
    startMs: 1_768_396_800_000,
    endMs: 1_768_483_200_000,
  },
  {
    value: null,
    unit: "count",
    startMs: 1_768_483_200_000,
    endMs: 1_768_569_600_000,
  },
];
const healthSamples: HealthSample[] = [
  {
    startMs: 1_768_480_000_000,
    endMs: 1_768_480_060_000,
    value: 118,
    unit: "count/min",
  },
];
const pedometerData: WirePedometerData = {
  startMs: 1_768_396_800_000,
  endMs: 1_768_483_200_000,
  steps: 8412,
  distanceMeters: 6_210.5,
  floorsAscended: 12,
  floorsDescended: 9,
  // Live-only on the wire; a historical query omits them. The fixture carries
  // them so the declared shape is exercised in full.
  currentPaceSecPerMeter: 0.42,
  currentCadenceStepsPerSec: 1.85,
  averageActivePaceSecPerMeter: 0.51,
};
const workoutState: WorkoutState = {
  state: "ended",
  elapsedMs: 1_845_000,
  activityType: "running",
  location: "outdoor",
  endedReason: "requested",
  endedDurationMs: 1_845_000,
  endedWorkoutId: "6C7F1B0E-6C3E-4B0A-9F1D-2A9E4F1B7C10",
  endedTotalEnergyKcal: 312.5,
  endedDistanceMeters: 5_412.75,
};
const sleepSamples: SleepSample[] = [
  {
    startMs: 1_768_432_800_000,
    endMs: 1_768_450_800_000,
    stage: "asleepDeep",
  },
];
// WorkoutKit plans. The id is a real UUID on purpose: native REJECTS a
// non-UUID rather than minting a replacement, so a fixture carrying a
// made-up string would encode the opposite of the contract.
const scheduledWorkoutSummary: ScheduledWorkoutSummary = {
  id: "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
  atMs: 1_768_476_600_000,
  complete: false,
  activityType: "running",
};
const scheduledWorkoutSummaries: ScheduledWorkoutSummary[] = [
  scheduledWorkoutSummary,
  // The second is COMPLETE and carries no activityType — the two states the
  // first one cannot show: `complete` is set by the Workout app (nothing in
  // this API writes it), and the activity is omitted rather than guessed when
  // this binary's vocabulary has no name for the stored case.
  {
    id: "9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D",
    atMs: 1_768_563_000_000,
    complete: true,
  },
];
/** Every alert kind, one per step, so the flat alert shape is exercised in
 *  full by a single custom plan rather than by nine near-identical fixtures. */
const everyAlertStep: WorkoutPlanIntervalStep[] = [
  {
    purpose: "work",
    goal: { kind: "distance", meters: 400 },
    alert: { kind: "heartRateRange", lowerBpm: 150, upperBpm: 170 },
  },
  { purpose: "recovery", alert: { kind: "heartRateZone", zone: 2 } },
  {
    purpose: "work",
    goal: { kind: "time", seconds: 180 },
    alert: {
      kind: "speedRange",
      lowerMetersPerSecond: 3.1,
      upperMetersPerSecond: 3.9,
      metric: "average",
    },
  },
  {
    purpose: "work",
    alert: { kind: "speedThreshold", metersPerSecond: 3.33, metric: "current" },
  },
  {
    purpose: "work",
    alert: {
      kind: "cadenceRange",
      lowerCountPerMinute: 170,
      upperCountPerMinute: 185,
    },
  },
  {
    purpose: "recovery",
    alert: { kind: "cadenceThreshold", countPerMinute: 160 },
  },
  {
    purpose: "work",
    alert: { kind: "powerRange", lowerWatts: 210, upperWatts: 260 },
  },
  { purpose: "work", alert: { kind: "powerThreshold", watts: 240 } },
  { purpose: "recovery", alert: { kind: "powerZone", zone: 3 } },
];
const customWorkoutPlan: WorkoutPlanSpec = {
  kind: "custom",
  id: "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
  activityType: "running",
  location: "outdoor",
  displayName: "6 × 400m",
  warmup: { goal: { kind: "time", seconds: 600 } },
  blocks: [{ steps: everyAlertStep, iterations: 6 }],
  cooldown: { goal: { kind: "open" } },
};
const singleGoalWorkoutPlan: WorkoutPlanSpec = {
  kind: "singleGoal",
  activityType: "cycling",
  location: "indoor",
  // The ONE kind where an energy goal is legal — Apple's own
  // CustomWorkout.supportsGoal(.energy, …) is false for every combination.
  goal: { kind: "energy", kilocalories: 400 },
};
const pacerWorkoutPlan: WorkoutPlanSpec = {
  kind: "pacer",
  activityType: "running",
  distanceMeters: 5000,
  durationSeconds: 1500,
};
const fileTransferHandle: FileTransferHandle = { id: 3 };
const fileTransfers: FileTransferStatus[] = [
  // Two entries on purpose: the id-bearing one (queued by this launch) and the
  // `id`-less one (queued by a PREVIOUS launch), which is the whole reason the
  // field is optional.
  {
    id: 3,
    name: "run-2026-07-29.gpx",
    transferring: true,
    fractionCompleted: 0.42,
  },
  { name: "export.json", transferring: false, fractionCompleted: 1 },
];
const calendarEvents: CalendarEvent[] = [
  {
    id: "8A0F1C2E-standup",
    title: "Standup",
    startMs: 1_768_471_200_000,
    endMs: 1_768_472_100_000,
    allDay: false,
    location: "Room 3",
    calendarTitle: "Work",
  },
];
const reminders: Reminder[] = [
  {
    id: "x-apple-reminderkit://REMCDReminder/1",
    title: "Buy milk",
    dueMs: 1_768_500_000_000,
    completed: false,
    calendarTitle: "Groceries",
  },
];
const receivedFileChunk: ReceivedFileChunk = {
  // A NON-final chunk: `eof: false` with `bytes` short of `totalBytes` is the
  // state a caller loops on, and the one a "whole file" reply would never
  // exercise. `bytes` is a multiple of 3 because the host trims a non-final
  // chunk so successive base64 strings concatenate.
  base64: "aGVsbG8gd29y",
  bytes: 9,
  offset: 0,
  totalBytes: 4096,
  eof: false,
};
const connectivityState: ConnectivityState = {
  activationState: "activated",
  reachable: true,
  companionAppInstalled: true,
  hasContentPending: false,
};

/** What the mock host resolves each method with (empty string = void). */
const RESULTS: Record<string, unknown> = {
  getDeviceInfo: deviceInfo,
  getUpdateState: updateState,
  saveUpdate: saveUpdateResult,
  getProducts: products,
  purchase: purchaseResult,
  searchPOI: poiResults,
  getCurrentLocation: coordinate,
  queryHealthStatistics: healthStatistics,
  queryHealthDailyStatistics: healthDailyStatistics,
  queryHealthSamples: healthSamples,
  querySleepSamples: sleepSamples,
  endWorkout: workoutState,
  getWorkoutState: workoutState,
  queryPedometer: pedometerData,
  transferFile: fileTransferHandle,
  outstandingFileTransfers: fileTransfers,
  getConnectivityState: connectivityState,
  readReceivedFile: receivedFileChunk,
  getCalendarEvents: calendarEvents,
  getReminders: reminders,
  scheduleWorkoutPlan: scheduledWorkoutSummary,
  listScheduledWorkoutPlans: scheduledWorkoutSummaries,
  requestWorkoutPlanAuthorization: "authorized",
  removeScheduledWorkoutPlan: true,
};

/**
 * A host that records the real `payloadJson` per method and settles from
 * `RESULTS`. Deliberately not `installMockHost()`: that one routes a handful of
 * methods and rejects the rest with UNKNOWN_METHOD, which would make the
 * payload-swallowing wrappers (applyUpdate, getUpdateState) report their
 * fallback instead of the fixture.
 */
/** Every payload recorded this run, across every host installed in this file.
 *  `installRecordingHost()` hands each test its own map, so the "declares a
 *  shape" assertion below would only ever see that test's own two calls;
 *  accumulating here lets it judge the whole file's real traffic. */
const sentPayloads = new Map<string, string>();

function installRecordingHost(): Map<string, string> {
  const payloads = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g.__host = {
    invoke: (id: number, method: string, payloadJson: string) => {
      payloads.set(method, payloadJson);
      sentPayloads.set(method, payloadJson);
      const result = RESULTS[method];
      (g.__resolveInvoke as (i: number, j: string) => void)(
        id,
        result === undefined ? "" : JSON.stringify(result),
      );
    },
  };
  return payloads;
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__host;
  delete g.__resolveInvoke;
  delete g.__rejectInvoke;
});

describe("invoke contract fixtures (ARCH-11)", () => {
  it("writes the real payload every payload-carrying wrapper produces", async () => {
    const payloads = installRecordingHost();

    await scheduleNotification({
      id: "fixture-notification",
      title: "Stand up",
      body: "You have been sitting for an hour",
      afterMs: 60_000,
      sound: true,
    });
    await bleConnect("0000FFE0-0000-1000-8000-00805F9B34FB", {
      maxReconnectAttempts: 3,
      reconnectWindowMs: 30_000,
    });
    await bleWrite("0000FFE1-0000-1000-8000-00805F9B34FB", "play", {
      confirm: true,
    });
    await bleSubscribe("0000FFE1-0000-1000-8000-00805F9B34FB");
    await applyUpdate(
      "globalThis.__bundle = 1;",
      7,
      "c2lnbmF0dXJl",
      "k1",
      ["storage", "widgets"],
      1,
      1_800_000_000,
    );
    await scheduleBackgroundRefresh(900_000, { reason: "hourly-refresh" });
    await Keychain.set("auth.token", "s3cret");
    await Keychain.get("auth.token");
    await Keychain.delete("auth.token");
    await speak("Time to breathe", {
      rate: 0.5,
      pitch: 1.1,
      language: "en-US",
      volume: 0.8,
    });
    await playAudio("https://example.test/chime.m4a", {
      volume: 0.7,
      loop: false,
    });
    await getProducts(["com.example.pro"]);
    await purchase("com.example.pro");
    await searchPOI("coffee", { latitude: 41.0, longitude: 29.0, span: 0.05 });
    // Health reads: `sleep` and `limit` are optional but still declared, and
    // the field-coverage assertion below requires every declared field to ride
    // some fixture — so each call opts into all of them.
    await requestHealthAuthorization({ read: ["stepCount"], sleep: true });
    await queryHealthStatistics({
      type: "stepCount",
      statistic: "sum",
      startMs: 1_768_396_800_000,
      endMs: 1_768_483_200_000,
    });
    // Same declared request shape as the scalar query — a bucket IS that
    // aggregate over one day — so this fixture proves the bucketed wrapper
    // still sends the identical payload rather than growing a private one.
    await queryHealthDailyStatistics({
      type: "stepCount",
      statistic: "sum",
      startMs: 1_768_396_800_000,
      endMs: 1_769_001_600_000,
    });
    await queryHealthSamples({
      type: "heartRate",
      startMs: 1_768_396_800_000,
      endMs: 1_768_483_200_000,
      limit: 200,
    });
    await querySleepSamples({
      startMs: 1_768_396_800_000,
      endMs: 1_768_483_200_000,
      limit: 50,
    });
    await startWorkout("running", {
      location: "outdoor",
      metricsIntervalMs: 2000,
      collectRoute: true,
    });
    await endWorkout({ discard: false });
    await queryPedometer({
      startMs: 1_768_396_800_000,
      endMs: 1_768_483_200_000,
    });
    // Opaque (the three connectivity channels): the payload is the app's own
    // JSON. Swift never reads a field — it only requires a JSON OBJECT, which
    // is exactly what the Swift side asserts about these fixtures.
    await sendToPhone({ type: "sync", payload: { steps: 4210 } });
    await updateApplicationContext({ theme: "dark", units: "metric" });
    await transferUserInfo({ workoutId: "w-42", endedAt: 1_768_483_200_000 });
    // NOT opaque, unlike its three siblings: Swift reads `path` (and validates
    // it) before WCSession sees anything, so the shape is declared.
    await transferFile("file:///var/tmp/run-2026-07-29.gpx", {
      workoutId: "w-42",
    });
    await cancelFileTransfer(3);
    await deleteReceivedFile(
      "file:///var/tmp/inbox/1768483200000-1-export.json",
    );
    // Both optionals ride this one: the field-coverage assertion below wants
    // every declared field in some fixture, and `offset`/`length` are exactly
    // the pair a caller omits on the first read.
    await readReceivedFile(
      "file:///var/tmp/inbox/1768483200000-1-export.json",
      { offset: 4096, length: 65_536 },
    );
    // EventKit: every optional (`limit`, `dueBeforeMs`) rides a fixture, so
    // the field-coverage assertion below has real traffic to judge.
    await requestCalendarAccess("events");
    await getCalendarEvents({
      startMs: 1_768_464_000_000,
      endMs: 1_768_550_400_000,
      limit: 20,
    });
    await getReminders({ dueBeforeMs: 1_768_550_400_000, limit: 20 });
    // WorkoutKit: the canonical fixture is the CUSTOM plan carrying every
    // alert kind, a warmup, a cooldown and an iteration count — the flat
    // alert/step/block shapes have no other way to be exercised in full.
    await scheduleWorkoutPlan(customWorkoutPlan, 1_768_476_600_000);
    await removeScheduledWorkoutPlan(
      "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
      new Date(1_768_476_600_000),
    );
    await openWorkoutPlanInWorkoutApp(customWorkoutPlan);
    // No payload at all — driven here so the "declares a request shape for
    // every wrapper that sends payload fields" check sees them as empty.
    await requestWorkoutPlanAuthorization();
    await removeAllScheduledWorkoutPlans();

    for (const [method, payloadJson] of payloads) {
      if (!(method in INVOKE_SHAPES)) continue;
      const shape = INVOKE_SHAPES[method as keyof typeof INVOKE_SHAPES];
      if (!("request" in shape)) continue;
      expect(payloadJson, `${method} sent no payload`).not.toBe("");
      writeFixture(method, "request", payloadJson);
    }

    // `at` and `afterMs` are the one mutually EXCLUSIVE pair in the declared
    // request surface (`at` wins over `afterMs`), so no single payload can
    // carry both the way a caller would write them — and the field-coverage
    // assertion below would have to except one of them, which is exactly the
    // hole it exists to close. A second fixture exercises the other half; the
    // Swift side decodes it with the same strict decoder. Written after the
    // loop because it reuses the method's recording slot.
    await scheduleNotification({
      id: "fixture-notification-at",
      title: "Stand up",
      body: "You have been sitting for an hour",
      at: new Date(1_800_000_000_000),
      sound: false,
    });
    writeFixture(
      "scheduleNotification",
      "request",
      payloads.get("scheduleNotification") as string,
      "at",
    );

    // The other two plan KINDS. Same reason as the `at` variant above: one
    // payload cannot carry `goal` and `distanceMeters` and `blocks` — the wire
    // struct is flat with a `kind` discriminator, and native REJECTS a field
    // belonging to another kind rather than ignoring it, so each kind needs
    // its own fixture or two thirds of the declared shape rides nothing.
    await scheduleWorkoutPlan(singleGoalWorkoutPlan, 1_768_563_000_000);
    writeFixture(
      "scheduleWorkoutPlan",
      "request",
      payloads.get("scheduleWorkoutPlan") as string,
      "singleGoal",
    );
    await scheduleWorkoutPlan(pacerWorkoutPlan, 1_768_649_400_000);
    writeFixture(
      "scheduleWorkoutPlan",
      "request",
      payloads.get("scheduleWorkoutPlan") as string,
      "pacer",
    );
    await openWorkoutPlanInWorkoutApp(pacerWorkoutPlan);
    writeFixture(
      "openWorkoutPlanInWorkoutApp",
      "request",
      payloads.get("openWorkoutPlanInWorkoutApp") as string,
      "pacer",
    );
  });

  it("writes the result shape every shape-returning wrapper resolves", async () => {
    installRecordingHost();
    // Each wrapper returns the native result verbatim, so what is captured is
    // what a caller actually gets — through the real settle()/JSON.parse path.
    writeFixture(
      "getDeviceInfo",
      "response",
      JSON.stringify(await getDeviceInfo()),
    );
    writeFixture(
      "getUpdateState",
      "response",
      JSON.stringify(await getUpdateState()),
    );
    writeFixture(
      "saveUpdate",
      "response",
      JSON.stringify(await applyUpdate("globalThis.x = 1;")),
    );
    writeFixture(
      "getProducts",
      "response",
      JSON.stringify(await getProducts(["com.example.pro"])),
    );
    writeFixture(
      "purchase",
      "response",
      JSON.stringify(await purchase("com.example.pro")),
    );
    writeFixture(
      "searchPOI",
      "response",
      JSON.stringify(await searchPOI("coffee")),
    );
    writeFixture(
      "getCurrentLocation",
      "response",
      JSON.stringify(await getCurrentLocation()),
    );
    writeFixture("endWorkout", "response", JSON.stringify(await endWorkout()));
    writeFixture(
      "queryPedometer",
      "response",
      JSON.stringify(
        await queryPedometer({
          startMs: 1_768_396_800_000,
          endMs: 1_768_483_200_000,
        }),
      ),
    );
    writeFixture(
      "getWorkoutState",
      "response",
      JSON.stringify(await getWorkoutState()),
    );
    writeFixture(
      "queryHealthStatistics",
      "response",
      JSON.stringify(
        await queryHealthStatistics({
          type: "stepCount",
          statistic: "sum",
          startMs: 1_768_396_800_000,
          endMs: 1_768_483_200_000,
        }),
      ),
    );
    writeFixture(
      "queryHealthDailyStatistics",
      "response",
      JSON.stringify(
        await queryHealthDailyStatistics({
          type: "stepCount",
          statistic: "sum",
          startMs: 1_768_396_800_000,
          endMs: 1_768_569_600_000,
        }),
      ),
    );
    writeFixture(
      "queryHealthSamples",
      "response",
      JSON.stringify(
        await queryHealthSamples({
          type: "heartRate",
          startMs: 1_768_396_800_000,
          endMs: 1_768_483_200_000,
        }),
      ),
    );
    writeFixture(
      "transferFile",
      "response",
      JSON.stringify(await transferFile("file:///var/tmp/run.gpx")),
    );
    writeFixture(
      "outstandingFileTransfers",
      "response",
      JSON.stringify(await outstandingFileTransfers()),
    );
    writeFixture(
      "getConnectivityState",
      "response",
      JSON.stringify(await getConnectivityState()),
    );
    writeFixture(
      "readReceivedFile",
      "response",
      JSON.stringify(
        await readReceivedFile("file:///var/tmp/inbox/1-1-export.json"),
      ),
    );
    writeFixture(
      "getCalendarEvents",
      "response",
      JSON.stringify(
        await getCalendarEvents({
          startMs: 1_768_464_000_000,
          endMs: 1_768_550_400_000,
        }),
      ),
    );
    writeFixture(
      "getReminders",
      "response",
      JSON.stringify(await getReminders()),
    );
    writeFixture(
      "querySleepSamples",
      "response",
      JSON.stringify(
        await querySleepSamples({
          startMs: 1_768_396_800_000,
          endMs: 1_768_483_200_000,
        }),
      ),
    );
    writeFixture(
      "scheduleWorkoutPlan",
      "response",
      JSON.stringify(
        await scheduleWorkoutPlan(customWorkoutPlan, 1_768_476_600_000),
      ),
    );
    writeFixture(
      "listScheduledWorkoutPlans",
      "response",
      JSON.stringify(await listScheduledWorkoutPlans()),
    );
  });

  it("covers every shape the schema declares (no method left un-fixtured)", () => {
    // Drives off the generated table, so adding `request`/`response` to a
    // schema method without driving its wrapper here fails immediately —
    // the same completeness contract the kitchen-sink fixture has.
    const missing: string[] = [];
    for (const [method, shape] of Object.entries(INVOKE_SHAPES)) {
      if ("request" in shape && !wroteRequest.has(method)) {
        missing.push(`${method} request`);
      }
      if ("response" in shape && !wroteResponse.has(method)) {
        missing.push(`${method} response`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("carries every declared request field in at least one fixture", () => {
    // The gap the strict Swift decoder cannot see: it rejects an UNDECLARED
    // key and a missing REQUIRED one, but a pure DROP of an optional field
    // (removed from the wrapper with nothing put in its place) just makes the
    // fixture one key smaller, and it still decodes. Nothing then connects the
    // schema's `at?`/`confirm?`/`span?` to any traffic at all.
    //
    // Requiring every declared field — optional included — to appear in some
    // fixture written THIS RUN makes the fixtures the evidence they claim to
    // be: a dropped optional leaves its field un-exercised and fails here.
    // There is deliberately no exception list; the one field pair that cannot
    // share a payload (`at`/`afterMs`) gets a second fixture above instead.
    const missing: string[] = [];
    for (const [method, shape] of Object.entries(INVOKE_SHAPES)) {
      if (!("request" in shape) || shape.request === "opaque") continue;
      const declared = invokeShapes.find((s) => s.ts === shape.request);
      expect(
        declared,
        `no invokeShapes entry for ${shape.request}`,
      ).toBeDefined();
      const seen = requestFields.get(method) ?? new Set<string>();
      for (const field of declared?.fields ?? []) {
        if (!seen.has(field.name)) missing.push(`${method}.${field.name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("declares a request shape for every wrapper that sends payload fields", async () => {
    // The other direction: a wrapper that ships fields with no declared
    // `request` is an undeclared seam. `aiAvailability` stands in for the
    // no-payload majority — it must stay absent from the table.
    const payloads = installRecordingHost();
    await isOnDeviceAIAvailable();
    // The one payload-sending wrapper no test above drives.
    await markUpdateHealthy();
    expect(payloads.get("aiAvailability")).toBe("");
    expect("aiAvailability" in INVOKE_SHAPES).toBe(false);

    // Judged over `sentPayloads` (the whole file's traffic), not `payloads`:
    // this test's own calls carry no fields, so filtering its map alone would
    // pass no matter what the schema said.
    const undeclared = [...sentPayloads]
      .filter(([method, json]) => {
        // "" = no payload; "{}" = an argument-less call — no field to drift,
        // which is why getUpdateState/markUpdateHealthy need no `request`.
        if (json === "" || json === "{}") return false;
        const shape = INVOKE_SHAPES[method as keyof typeof INVOKE_SHAPES];
        return shape === undefined || !("request" in shape);
      })
      .map(([method]) => method);
    expect(undeclared).toEqual([]);
  });
});

/**
 * Mutual assignability AND identical key sets — i.e. the two declarations are
 * the same type, not merely compatible. Width subtyping means one-way
 * assignability would let an extra field through; comparing `keyof` both ways
 * catches that, including a field that differs only in optionality.
 */
type Exact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? [keyof A] extends [keyof B]
      ? [keyof B] extends [keyof A]
        ? true
        : never
      : never
    : never
  : never;

describe("invoke result shapes are type-identical to the public interfaces", () => {
  it("binds each schema result shape to the interface callers already use", () => {
    // These are COMPILE-time assertions: `true` is not assignable to `never`,
    // so a field added to `DeviceInfo` in device.ts without the schema (or the
    // reverse) fails `npm run typecheck`. The runtime expect only keeps the
    // bindings from being elided as unused — hence `Array(n).fill(true)`
    // rather than a hand-counted literal, which only ever drifts.
    const deviceInfoExact: Exact<DeviceInfo, WireDeviceInfo> = true;
    const updateStateExact: Exact<UpdateState, WireUpdateState> = true;
    const saveUpdateExact: Exact<SaveUpdateResult, WireSaveUpdateResult> = true;
    const productExact: Exact<IAPProduct, WireIAPProduct> = true;
    const purchaseExact: Exact<PurchaseResult, WirePurchaseResult> = true;
    const poiExact: Exact<POIResult, WirePOIResult> = true;
    const coordinateExact: Exact<Coordinate, WireCoordinate> = true;
    const healthStatisticsExact: Exact<
      HealthStatisticsResult,
      WireHealthStatisticsResult
    > = true;
    const healthSampleExact: Exact<HealthSample, WireHealthSample> = true;
    const sleepSampleExact: Exact<SleepSample, WireSleepSample> = true;
    const workoutStateExact: Exact<WorkoutState, WireWorkoutState> = true;
    const fileTransferHandleExact: Exact<
      FileTransferHandle,
      WireFileTransferHandle
    > = true;
    const fileTransferStatusExact: Exact<
      FileTransferStatus,
      WireFileTransferStatus
    > = true;
    const connectivityStateExact: Exact<
      ConnectivityState,
      WireConnectivityState
    > = true;
    const receivedFileChunkExact: Exact<
      ReceivedFileChunk,
      WireReceivedFileChunk
    > = true;
    const calendarEventExact: Exact<CalendarEvent, WireCalendarEvent> = true;
    const reminderExact: Exact<Reminder, WireReminder> = true;
    const scheduledWorkoutExact: Exact<
      ScheduledWorkoutSummary,
      WireScheduledWorkoutSummary
    > = true;
    expect([
      deviceInfoExact,
      updateStateExact,
      saveUpdateExact,
      productExact,
      purchaseExact,
      poiExact,
      coordinateExact,
      healthStatisticsExact,
      healthSampleExact,
      sleepSampleExact,
      workoutStateExact,
      fileTransferHandleExact,
      fileTransferStatusExact,
      connectivityStateExact,
      receivedFileChunkExact,
      calendarEventExact,
      reminderExact,
      scheduledWorkoutExact,
    ]).toEqual(Array(18).fill(true));
  });
});
