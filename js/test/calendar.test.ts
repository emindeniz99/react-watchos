import { afterEach, describe, expect, it } from "vitest";
import {
  getCalendarEvents,
  getReminders,
  requestCalendarAccess,
} from "../src/calendar";
import { installMockHost } from "./helpers";

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.__host;
  delete g.__resolveInvoke;
  delete g.__rejectInvoke;
});

/** Settles every invoke with `result`, and records what was sent. */
function respondWith(result: unknown) {
  const host = installMockHost();
  host.invoke.mockImplementation((id: number) => {
    (g.__resolveInvoke as (i: number, j: string) => void)(
      id,
      JSON.stringify(result),
    );
  });
  return host;
}

describe("EventKit reads route through invoke", () => {
  it("requestCalendarAccess asks per entity and reports writeOnly as itself", async () => {
    // The two entities are two independent OS permissions, so the wrapper
    // takes one and an app asks only for what it shows.
    const host = respondWith("writeOnly");
    expect(await requestCalendarAccess("events")).toBe("writeOnly");
    await requestCalendarAccess("reminders");
    expect(
      host.invoke.mock.calls.map((c) => [c[1], JSON.parse(c[2] as string)]),
    ).toEqual([
      ["requestCalendarAccess", { entity: "events" }],
      ["requestCalendarAccess", { entity: "reminders" }],
    ]);
  });

  it("getCalendarEvents forwards the window and resolves the events", async () => {
    const host = respondWith([
      {
        id: "e1",
        title: "Standup",
        startMs: 1_768_471_200_000,
        endMs: 1_768_472_100_000,
        allDay: false,
        calendarTitle: "Work",
      },
    ]);
    const events = await getCalendarEvents({
      startMs: 1_768_464_000_000,
      endMs: 1_768_550_400_000,
      limit: 20,
    });
    expect(JSON.parse(host.invoke.mock.calls[0]?.[2] as string)).toEqual({
      startMs: 1_768_464_000_000,
      endMs: 1_768_550_400_000,
      limit: 20,
    });
    // `location` is genuinely absent for an event without one, not "".
    expect(events[0]?.location).toBeUndefined();
    expect(events[0]?.title).toBe("Standup");
  });

  it("getReminders is callable with no arguments", async () => {
    // Both fields are optional and native defaults the window to 30 days, so
    // an argument-less call must send a legal payload rather than nothing the
    // handler has to guess about.
    const host = respondWith([]);
    expect(await getReminders()).toEqual([]);
    await getReminders({ limit: 5 });
    expect(
      host.invoke.mock.calls.map((c) => JSON.parse(c[2] as string)),
    ).toEqual([{}, { limit: 5 }]);
  });

  it("a denied read rejects PERMISSION_DENIED rather than resolving []", async () => {
    // The `handleSearchPOI` split, applied: an empty window is `[]`, but "you
    // said no" must not be indistinguishable from "nothing scheduled".
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (g.__rejectInvoke as (i: number, j: string) => void)(
        id,
        JSON.stringify({
          code: "PERMISSION_DENIED",
          message: "access to events is denied",
        }),
      );
    });
    await expect(
      getCalendarEvents({ startMs: 1, endMs: 2 }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
