import { getHost } from "./host";

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

/** Ask the user for notification permission (first call shows the prompt). */
export function requestNotificationPermission(): void {
  getHost()?.requestNotificationPermission?.();
}

/** Schedules a local notification; returns its id for cancelNotification. */
export function scheduleNotification(request: NotificationRequest): string {
  const id = request.id ?? `react-notification-${nextId++}`;
  getHost()?.scheduleNotification?.(
    JSON.stringify({
      id,
      title: request.title,
      body: request.body ?? "",
      at: request.at instanceof Date ? request.at.getTime() : request.at,
      afterMs: request.afterMs,
      sound: request.sound ?? true,
    }),
  );
  return id;
}

export function cancelNotification(id: string): void {
  getHost()?.cancelNotification?.(id);
}
