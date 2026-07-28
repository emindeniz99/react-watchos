import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { invokeShapes } from "../codegen/schema";
import { isOnDeviceAIAvailable } from "../src/ai";
import { playAudio } from "../src/audio";
import { scheduleBackgroundRefresh } from "../src/background";
import { bleConnect, bleSubscribe, bleWrite } from "../src/bluetooth";
import {
  sendToPhone,
  transferUserInfo,
  updateApplicationContext,
} from "../src/connectivity";
import type { DeviceInfo } from "../src/device";
import { getDeviceInfo } from "../src/device";
import type {
  Coordinate as WireCoordinate,
  DeviceInfo as WireDeviceInfo,
  IAPProduct as WireIAPProduct,
  POIResult as WirePOIResult,
  PurchaseResult as WirePurchaseResult,
  SaveUpdateResult as WireSaveUpdateResult,
  UpdateState as WireUpdateState,
} from "../src/generated/wire";
import { INVOKE_SHAPES } from "../src/generated/wire";
import type { IAPProduct, PurchaseResult } from "../src/iap";
import { getProducts, purchase } from "../src/iap";
import { Keychain } from "../src/keychain";
import type { Coordinate, POIResult } from "../src/maps";
import { getCurrentLocation, searchPOI } from "../src/maps";
import { scheduleNotification } from "../src/notifications";
import { speak } from "../src/speech";
import type { SaveUpdateResult, UpdateState } from "../src/update";
import { applyUpdate, getUpdateState, markUpdateHealthy } from "../src/update";

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

/** What the mock host resolves each method with (empty string = void). */
const RESULTS: Record<string, unknown> = {
  getDeviceInfo: deviceInfo,
  getUpdateState: updateState,
  saveUpdate: saveUpdateResult,
  getProducts: products,
  purchase: purchaseResult,
  searchPOI: poiResults,
  getCurrentLocation: coordinate,
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
    // Opaque (the three connectivity channels): the payload is the app's own
    // JSON. Swift never reads a field — it only requires a JSON OBJECT, which
    // is exactly what the Swift side asserts about these fixtures.
    await sendToPhone({ type: "sync", payload: { steps: 4210 } });
    await updateApplicationContext({ theme: "dark", units: "metric" });
    await transferUserInfo({ workoutId: "w-42", endedAt: 1_768_483_200_000 });

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
    // reverse) fails `npm run typecheck`. The runtime expects only keep the
    // bindings from being elided as unused.
    const deviceInfoExact: Exact<DeviceInfo, WireDeviceInfo> = true;
    const updateStateExact: Exact<UpdateState, WireUpdateState> = true;
    const saveUpdateExact: Exact<SaveUpdateResult, WireSaveUpdateResult> = true;
    const productExact: Exact<IAPProduct, WireIAPProduct> = true;
    const purchaseExact: Exact<PurchaseResult, WirePurchaseResult> = true;
    const poiExact: Exact<POIResult, WirePOIResult> = true;
    const coordinateExact: Exact<Coordinate, WireCoordinate> = true;
    expect([
      deviceInfoExact,
      updateStateExact,
      saveUpdateExact,
      productExact,
      purchaseExact,
      poiExact,
      coordinateExact,
    ]).toEqual([true, true, true, true, true, true, true]);
  });
});
