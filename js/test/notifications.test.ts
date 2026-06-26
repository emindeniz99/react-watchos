import { afterEach, describe, expect, it } from "vitest";
import {
  cancelNotification,
  requestNotificationPermission,
  scheduleNotification,
} from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__host;
});

describe("notifications", () => {
  it("schedules with a generated id and defaults", () => {
    const host = installMockHost();
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
    const host = installMockHost();
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

  it("forwards permission requests (via invoke) and cancellations to the host", async () => {
    const host = installMockHost();
    const status = await requestNotificationPermission();
    cancelNotification("hydration.reminder");
    expect(host.invoke).toHaveBeenCalledWith(
      expect.any(Number),
      "requestNotificationPermission",
      "",
    );
    expect(status).toBe("granted");
    expect(host.cancelNotification).toHaveBeenCalledWith("hydration.reminder");
  });

  // CX-022: the real authorization status reaches JS (not a Bool that can't tell
  // provisional from full grant), and a native error rejects rather than vanishing.
  it("resolves the native authorization status", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (
        globalThis as {
          __resolveInvoke?: (id: number, resultJson: string) => void;
        }
      ).__resolveInvoke?.(id, JSON.stringify("provisional"));
    });
    expect(await requestNotificationPermission()).toBe("provisional");
  });

  it("rejects when the native request errors", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (
        globalThis as {
          __rejectInvoke?: (id: number, errorJson: string) => void;
        }
      ).__rejectInvoke?.(
        id,
        JSON.stringify({ code: "INTERNAL", message: "boom" }),
      );
    });
    await expect(requestNotificationPermission()).rejects.toThrow("boom");
  });

  it("resolves 'unavailable' without a notification-capable host", async () => {
    expect(() =>
      scheduleNotification({ title: "x", afterMs: 1000 }),
    ).not.toThrow();
    expect(await requestNotificationPermission()).toBe("unavailable");
    expect(() => cancelNotification("x")).not.toThrow();
  });
});
