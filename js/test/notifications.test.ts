import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelNotification,
  requestNotificationPermission,
  scheduleNotification,
} from "../src/index";

function installHost() {
  const host = {
    commit: vi.fn(),
    log: vi.fn(),
    setTimer: vi.fn(),
    requestNotificationPermission: vi.fn(),
    scheduleNotification: vi.fn(),
    cancelNotification: vi.fn(),
  };
  (globalThis as Record<string, unknown>).__host = host;
  return host;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__host;
});

describe("notifications", () => {
  it("schedules with a generated id and defaults", () => {
    const host = installHost();
    const id = scheduleNotification({ title: "Hydration", afterMs: 60_000 });
    expect(id).toMatch(/^react-notification-/);
    expect(JSON.parse(host.scheduleNotification.mock.calls[0][0])).toEqual({
      id,
      title: "Hydration",
      body: "",
      at: undefined,
      afterMs: 60_000,
      sound: true,
    });
  });

  it("keeps explicit ids and normalizes Date `at` to epoch ms", () => {
    const host = installHost();
    const at = new Date(1_750_000_000_000);
    const id = scheduleNotification({
      id: "hydration.reminder",
      title: "Water",
      body: "Drink up",
      at,
      sound: false,
    });
    expect(id).toBe("hydration.reminder");
    const payload = JSON.parse(host.scheduleNotification.mock.calls[0][0]);
    expect(payload.at).toBe(1_750_000_000_000);
    expect(payload.sound).toBe(false);
  });

  it("forwards permission requests and cancellations to the host", () => {
    const host = installHost();
    requestNotificationPermission();
    cancelNotification("hydration.reminder");
    expect(host.requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(host.cancelNotification).toHaveBeenCalledWith("hydration.reminder");
  });

  it("is a no-op without a notification-capable host", () => {
    expect(() =>
      scheduleNotification({ title: "x", afterMs: 1000 }),
    ).not.toThrow();
    expect(() => requestNotificationPermission()).not.toThrow();
    expect(() => cancelNotification("x")).not.toThrow();
  });
});
