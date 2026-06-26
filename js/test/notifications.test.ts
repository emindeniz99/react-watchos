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
  it("schedules with a generated id + defaults via invoke and resolves scheduled", async () => {
    const host = installMockHost();
    const result = await scheduleNotification({
      title: "Hydration",
      afterMs: 60_000,
    });
    expect(result.id).toMatch(/^react-notification-/);
    expect(result.scheduled).toBe(true);
    // Routed through the generic invoke channel (SD-1), not a direct host method.
    expect(host.invoke).toHaveBeenCalledWith(
      expect.any(Number),
      "scheduleNotification",
      JSON.stringify({
        id: result.id,
        title: "Hydration",
        body: "",
        at: undefined,
        afterMs: 60_000,
        sound: true,
      }),
    );
  });

  it("keeps explicit ids and normalizes Date `at` to epoch ms", async () => {
    const host = installMockHost();
    const at = new Date(1_750_000_000_000);
    const result = await scheduleNotification({
      id: "hydration.reminder",
      title: "Water",
      body: "Drink up",
      at,
      sound: false,
    });
    expect(result.id).toBe("hydration.reminder");
    const payload = JSON.parse(host.invoke.mock.calls[0][2]);
    expect(payload.at).toBe(1_750_000_000_000);
    expect(payload.sound).toBe(false);
  });

  // CX-022: a native UNUserNotificationCenter.add failure must reach JS as a
  // resolved { scheduled: false } with the reason, not vanish into runtimeError.
  it("resolves scheduled:false with the native reason on a scheduling error", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number, method: string) => {
      const g = globalThis as {
        __rejectInvoke?: (id: number, errorJson: string) => void;
      };
      if (method === "scheduleNotification") {
        g.__rejectInvoke?.(
          id,
          JSON.stringify({ code: "INTERNAL", message: "too many pending" }),
        );
      }
    });
    const result = await scheduleNotification({ title: "x", afterMs: 1000 });
    expect(result.scheduled).toBe(false);
    expect(result.code).toBe("INTERNAL");
    expect(result.message).toBe("too many pending");
    expect(result.id).toMatch(/^react-notification-/);
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

  it("resolves not-scheduled / unavailable without a notification-capable host", async () => {
    const sched = await scheduleNotification({ title: "x", afterMs: 1000 });
    expect(sched.scheduled).toBe(false);
    expect(sched.code).toBe("UNAVAILABLE");
    expect(sched.id).toMatch(/^react-notification-/);
    expect(await requestNotificationPermission()).toBe("unavailable");
    expect(() => cancelNotification("x")).not.toThrow();
  });
});
