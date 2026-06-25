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

let nextPermissionId = 1;
const pendingPermissions = new Map<
  number,
  {
    resolve: (status: NotificationPermission) => void;
    reject: (e: unknown) => void;
  }
>();

/** Installs the host->JS settle globals for permission requests (CX-022).
 *  Idempotent; called lazily so the globals exist before the host replies. */
function installNotificationBridge(): void {
  const g = globalThis as {
    __resolveNotificationPermission?: (id: number, status: string) => void;
    __rejectNotificationPermission?: (id: number, message: string) => void;
  };
  if (g.__resolveNotificationPermission) return;
  g.__resolveNotificationPermission = (id, status) => {
    const p = pendingPermissions.get(id);
    if (!p) return;
    pendingPermissions.delete(id);
    p.resolve(status as NotificationPermission);
  };
  g.__rejectNotificationPermission = (id, message) => {
    const p = pendingPermissions.get(id);
    if (!p) return;
    pendingPermissions.delete(id);
    p.reject(new Error(message || "notification permission request failed"));
  };
}

/**
 * Asks the user for notification permission (first call shows the prompt) and
 * resolves the resulting authorization status (CX-022). Rejects only if the
 * native request errors; resolves `"unavailable"` when there's no
 * notification-capable host.
 */
export function requestNotificationPermission(): Promise<NotificationPermission> {
  const host = getHost();
  if (!host?.requestNotificationPermission) {
    return Promise.resolve("unavailable");
  }
  installNotificationBridge();
  return new Promise((resolve, reject) => {
    const id = nextPermissionId++;
    pendingPermissions.set(id, { resolve, reject });
    host.requestNotificationPermission?.(id);
  });
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
