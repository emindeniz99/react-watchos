import { describe, expect, it } from "vitest";
import { toggleStopwatch, type StopwatchState } from "../demo/App";

describe("demo stopwatch", () => {
  it("does not double-count elapsed time across start/stop cycles", () => {
    let state: StopwatchState = { startedAt: null, frozen: 0 };

    state = toggleStopwatch(state, 1_000);
    expect(state).toEqual({ startedAt: 1_000, frozen: 0 });

    state = toggleStopwatch(state, 2_500);
    expect(state).toEqual({ startedAt: null, frozen: 1_500 });

    state = toggleStopwatch(state, 10_000);
    expect(state).toEqual({ startedAt: 8_500, frozen: 1_500 });

    state = toggleStopwatch(state, 11_000);
    expect(state).toEqual({ startedAt: null, frozen: 2_500 });
  });
});
