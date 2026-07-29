import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryHost,
  startGyroscope,
  startHeartRate,
  startLocation,
  startMotion,
  startSensor,
  stopSensor,
  Text,
} from "../src/index";
import { __resetSensorCountsForTest } from "../src/sensors";
import { installMockHost, mountApp, resetApp } from "./helpers";

afterEach(resetApp);

function HeartRate() {
  const [bpm, setBpm] = useState(0);
  useEffect(() => {
    startHeartRate((r) => setBpm(Number(r?.bpm ?? 0)));
  }, []);
  return <Text>{String(bpm)}</Text>;
}

type PushFn = (name: string, payloadJson?: string) => boolean;

// Compile-time guard (never executed): SensorKind must stay closed over the
// four kinds SensorBridge.handleOp implements. When it ended in `| string` this
// line compiled clean, so `startSensor("steps", cb)` returned a working-looking
// unsubscribe and silently never emitted. If someone re-widens the union,
// @ts-expect-error goes unused and `pnpm typecheck` fails.
function _unknownSensorKindIsATypeError() {
  // @ts-expect-error "steps" is not a bound sensor kind
  startSensor("steps", () => {});
}

describe("sensor streams", () => {
  it("routes a sensor reading to the UI live", () => {
    const host = new MemoryHost();
    mountApp(<HeartRate />, host);
    expect(host.lastCommit!.root!.props.text).toBe("0");

    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    push("sensor.heartRate", JSON.stringify({ bpm: 72 }));
    expect(host.lastCommit!.root!.props.text).toBe("72");
  });

  it("start/stop forward op messages to the host", () => {
    const host = installMockHost();
    startSensor("motion", () => {});
    stopSensor("motion");
    expect(host.sensor.mock.calls.map((c) => JSON.parse(c[0]))).toEqual([
      { op: "start", kind: "motion" },
      { op: "stop", kind: "motion" },
    ]);
  });

  it("heart rate forwards keepAliveInBackground only when opted in", () => {
    const host = installMockHost();
    startHeartRate(() => {}); // default: no keep-alive field
    __resetSensorCountsForTest(); // let the next start re-send its op
    startHeartRate(() => {}, { keepAliveInBackground: true });
    expect(host.sensor.mock.calls.map((c) => JSON.parse(c[0]))).toEqual([
      { op: "start", kind: "heartRate" },
      { op: "start", kind: "heartRate", keepAliveInBackground: true },
    ]);
  });

  it("gyroscope and location conveniences start their kinds", () => {
    const host = installMockHost();
    startGyroscope(() => {});
    startLocation(() => {});
    expect(host.sensor.mock.calls.map((c) => JSON.parse(c[0]).kind)).toEqual([
      "gyroscope",
      "location",
    ]);
  });

  it("forwards motion rate and location tuning options only when set", () => {
    const host = installMockHost();
    startMotion(() => {}, { updateIntervalMs: 500 });
    startLocation(() => {}, {
      accuracy: "hundredMeters",
      distanceFilterMeters: 25,
    });
    expect(host.sensor.mock.calls.map((c) => JSON.parse(c[0]))).toEqual([
      { op: "start", kind: "motion", updateIntervalMs: 500 },
      {
        op: "start",
        kind: "location",
        accuracy: "hundredMeters",
        distanceFilterMeters: 25,
      },
    ]);
  });
});

// CX-014: the native stream is shared, so start/stop must be reference-counted.
// These encode WHY: a second subscriber must not re-start the hardware, and one
// component unmounting must not stop a stream others still depend on.
describe("sensor refcounting (CX-014)", () => {
  const ops = (host: ReturnType<typeof installMockHost>) =>
    host.sensor.mock.calls.map((c) => JSON.parse(c[0] as string));

  it("starts once for two subscribers and stops only when the last leaves", () => {
    const host = installMockHost();
    const off1 = startSensor("heartRate", () => {});
    const off2 = startSensor("heartRate", () => {});
    // Second subscriber rides the already-running stream — no second start.
    expect(ops(host)).toEqual([{ op: "start", kind: "heartRate" }]);

    off1(); // not the last subscriber → stream stays up
    expect(ops(host)).toEqual([{ op: "start", kind: "heartRate" }]);

    off2(); // last subscriber → now stop
    expect(ops(host)).toEqual([
      { op: "start", kind: "heartRate" },
      { op: "stop", kind: "heartRate" },
    ]);
  });

  it("treats a duplicate cleanup as a no-op (no spurious stop / negative count)", () => {
    const host = installMockHost();
    const off = startSensor("motion", () => {});
    off();
    off(); // calling cleanup twice must not emit a second stop
    expect(ops(host)).toEqual([
      { op: "start", kind: "motion" },
      { op: "stop", kind: "motion" },
    ]);
  });

  it("re-starts the stream when a kind is remounted after full cleanup", () => {
    const host = installMockHost();
    startSensor("gyroscope", () => {})(); // start then immediately stop
    startSensor("gyroscope", () => {}); // fresh subscriber → start again
    expect(ops(host)).toEqual([
      { op: "start", kind: "gyroscope" },
      { op: "stop", kind: "gyroscope" },
      { op: "start", kind: "gyroscope" },
    ]);
  });

  it("a late cleanup after stopSensor() emits no spurious stop", () => {
    const host = installMockHost();
    const off = startSensor("heartRate", () => {});
    stopSensor("heartRate"); // force-stop
    off(); // the earlier subscriber's late unmount must be a no-op
    expect(ops(host)).toEqual([
      { op: "start", kind: "heartRate" },
      { op: "stop", kind: "heartRate" },
    ]);
  });

  it("a late cleanup after stopSensor()+restart doesn't kill the new stream", () => {
    // The CX-014 hazard: a shared count would let the old subscriber's late
    // cleanup zero the count under the NEW subscriber and stop its live stream.
    const host = installMockHost();
    const off1 = startSensor("heartRate", () => {}); // stream A
    stopSensor("heartRate"); // stop A
    startSensor("heartRate", () => {}); // stream B — a new subscriber owns it
    off1(); // A's late unmount must NOT stop B
    expect(ops(host)).toEqual([
      { op: "start", kind: "heartRate" },
      { op: "stop", kind: "heartRate" },
      { op: "start", kind: "heartRate" }, // no trailing stop — B is still live
    ]);
  });
});
