import { getHost } from "./host";
import { type InvokeError, invoke } from "./invoke";

/**
 * Local notifications scheduled from React, delivered by the watch even
 * if the app has been suspended. No-ops where the host lacks the bridge
 * (tests, Node, the widget extension).
 */

export interface NotificationRequest {
  /** Stable id for cancel/replace; generated when omitted. */
  id?: string;
  title: string;
  body?: string;
  /** Deliver after this many ms from now... */
  afterMs?: number;
  /** ...or at an absolute time (ms since epoch or Date). Takes precedence. */
  at?: number | Date;
  /** Play the default sound (default true). */
  sound?: boolean;
}

let nextId = 1;

/**
 * The watch's notification authorization status (CX-022). Mirrors
 * UNAuthorizationStatus: `provisional` is granted-but-quiet (no prompt was
 * shown), distinct from a full `granted`; `notDetermined` means you may still
 * prompt; `unavailable` = no notification-capable host (tests/widget) or the
 * request errored upstream.
 */
export type NotificationPermission =
  | "granted"
  | "denied"
  | "notDetermined"
  | "provisional"
  | "unavailable";

/**
 * Asks the user for notification permission (first call shows the prompt) and
 * resolves the resulting authorization status (CX-022). Resolves `"unavailable"`
 * when there's no notification-capable host (tests/widget); rejects only if the
 * native request itself errors. Routed through the generic invoke channel.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  try {
    return await invoke<NotificationPermission>(
      "requestNotificationPermission",
    );
  } catch (error) {
    if ((error as InvokeError).code === "UNAVAILABLE") return "unavailable";
    throw error;
  }
}

/** The outcome of scheduling a notification (CX-022). `id` is the deterministic
 *  id (pass it to cancelNotification); `scheduled` is false when the watch
 *  refused it (e.g. the 64-pending limit, a bad trigger) or there's no
 *  notification host, with a machine `code` + message for the reason. */
export interface ScheduleNotificationResult {
  id: string;
  scheduled: boolean;
  /** Set when scheduled is false. */
  code?: string;
  message?: string;
}

/**
 * Schedules a local notification and resolves whether the watch accepted it
 * (CX-022). Routed through the generic invoke channel (SD-1) so a native failure
 * (UNUserNotificationCenter.add error) is reported instead of vanishing. The
 * `id` is deterministic — generated here when omitted and always returned in the
 * result — so callers can cancel it later regardless of the outcome. Resolves
 * (never rejects): no notification host (tests/Node/widget) comes back as
 * `{ scheduled: false, code: "UNAVAILABLE" }`.
 */
export async function scheduleNotification(
  request: NotificationRequest,
): Promise<ScheduleNotificationResult> {
  const id = request.id ?? `react-notification-${nextId++}`;
  try {
    await invoke<unknown>("scheduleNotification", {
      id,
      title: request.title,
      body: request.body ?? "",
      at: request.at instanceof Date ? request.at.getTime() : request.at,
      afterMs: request.afterMs,
      sound: request.sound ?? true,
    });
    return { id, scheduled: true };
  } catch (error) {
    return {
      id,
      scheduled: false,
      code: (error as InvokeError).code ?? "INTERNAL",
      message: error instanceof Error ? error.message : "notification rejected",
    };
  }
}

export function cancelNotification(id: string): void {
  getHost()?.cancelNotification?.(id);
}
