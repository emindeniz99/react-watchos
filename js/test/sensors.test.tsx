import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryHost,
  Text,
  runApp,
  startHeartRate,
  startSensor,
  stopSensor,
  unregisterAllNativeListeners,
} from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  unregisterAllNativeListeners();
  delete (globalThis as Record<string, unknown>).__host;
  delete (globalThis as Record<string, unknown>).__pushNativeEvent;
  delete (globalThis as Record<string, unknown>).__dispatchEvent;
});

function HeartRate() {
  const [bpm, setBpm] = useState(0);
  useEffect(() => {
    startHeartRate((r) => setBpm(Number(r?.bpm ?? 0)));
  }, []);
  return <Text>{String(bpm)}</Text>;
}

type PushFn = (name: string, payloadJson?: string) => boolean;

describe("sensor streams", () => {
  it("routes a sensor reading to the UI live", () => {
    const host = new MemoryHost();
    runApp(<HeartRate />, host);
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
});
