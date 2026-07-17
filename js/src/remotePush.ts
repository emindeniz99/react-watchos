import { invoke } from "./invoke";
import { registerNativeListener, type Unsubscribe } from "./nativeEvents";

/**
 * Remote push notifications (APNs). The watch receives its OWN device token —
 * for a standalone-capable app, servers should send to BOTH the watch token
 * and the paired-iPhone token (the system dedupes). Alert pushes need
 * notification permission ({@link requestNotificationPermission}) or they are
 * delivered silently; background (`content-available`) pushes wake the app
 * subject to the system's budget and arrive on {@link onRemotePush}.
 */
export const REMOTE_PUSH_EVENT = "remotePush";
export const REMOTE_PUSH_TOKEN_EVENT = "remotePush.token";
export const REMOTE_PUSH_REGISTRATION_ERROR_EVENT =
  "remotePush.registrationError";

/** The `aps` dictionary of an APNs payload (Apple's keys, hence the quoted
 *  hyphenated names). Everything is optional — a background push may carry
 *  only `content-available`; server-custom keys ride the index signature. */
export interface RemotePushAps {
  alert?: string | { title?: string; subtitle?: string; body?: string };
  badge?: number;
  sound?: string;
  category?: string;
  "thread-id"?: string;
  "content-available"?: 0 | 1;
  "mutable-content"?: 0 | 1;
  [key: string]: unknown;
}

/** A remote notification's userInfo: the APNs `aps` dictionary plus any
 *  custom top-level keys your server sends. */
export interface RemotePushNotification {
  aps?: RemotePushAps;
  [key: string]: unknown;
}

/**
 * Registers this launch with APNs and resolves the watch's device token as
 * lowercase hex — send it to your push server. Tokens are variable length and
 * can change between launches, so call this EVERY launch (never cache across
 * launches) and update the server with the fresh value; re-registration is
 * cheap. Rejects with an {@link import("./invoke").InvokeError} `UNAVAILABLE`
 * when there's no push-capable host (tests/widget) or registration fails
 * natively (e.g. a missing `aps-environment` entitlement — see the plugin's
 * `push: true` option). Registration isn't user-mediated (no permission
 * sheet), so the default 30 s invoke watchdog applies.
 */
export function registerForRemoteNotifications(): Promise<string> {
  return invoke<string>("registerForRemoteNotifications");
}

/**
 * Runs `handler` with each delivered remote notification's userInfo (the
 * `aps` dictionary + your server's custom keys). A registered listener is
 * what makes the native delegate report "new data" for a background push;
 * with no listener (or before the JS bundle has booted — e.g. a cold-launch
 * background push) the notification is dropped as "no data". Returns an
 * unsubscribe.
 */
export function onRemotePush(
  handler: (notification: RemotePushNotification) => void,
): Unsubscribe {
  return registerNativeListener(REMOTE_PUSH_EVENT, (payload) => {
    handler((payload ?? {}) as RemotePushNotification);
  });
}

/**
 * Runs `handler` with the lowercase-hex device token whenever registration
 * succeeds — including a registration the app didn't await (a token rotation,
 * or a consumer's own native register call). Returns an unsubscribe.
 */
export function onRemotePushToken(
  handler: (token: string) => void,
): Unsubscribe {
  return registerNativeListener(REMOTE_PUSH_TOKEN_EVENT, (payload) => {
    handler(String(payload?.token ?? ""));
  });
}

/**
 * Runs `handler` with the native error message whenever APNs registration
 * fails (missing `aps-environment` entitlement, no network, sandbox
 * mismatch). The same failure also rejects the pending
 * {@link registerForRemoteNotifications} promise; this is for passive
 * observers. Returns an unsubscribe.
 */
export function onRemotePushRegistrationError(
  handler: (message: string) => void,
): Unsubscribe {
  return registerNativeListener(
    REMOTE_PUSH_REGISTRATION_ERROR_EVENT,
    (payload) => {
      handler(String(payload?.message ?? ""));
    },
  );
}
