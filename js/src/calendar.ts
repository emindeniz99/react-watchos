import type { CalendarAccessRequest } from "./generated/wire";
import { invoke, USER_MEDIATED_INVOKE_TIMEOUT_MS } from "./invoke";

/**
 * EventKit **reads**: the user's upcoming events and their incomplete
 * reminders. Read-only in v1 — nothing here creates, edits or completes
 * anything.
 *
 * Gated by the `calendar` feature (ARCH-07), one feature covering both
 * entities: each carries its own OS-level permission prompt, so the OS already
 * gates them individually and the capability set only has to answer "may this
 * bundle touch the user's schedule at all".
 *
 * ### The one thing to understand about EventKit permissions
 *
 * Apple, *Accessing the event store*: **"Your app can't request read-only
 * access to either events or reminders. To read events or reminders from the
 * event store, your app needs full access."** So a read-only API still has to
 * ask for *full* access, and {@link requestCalendarAccess} does. The
 * write-only grant that also exists (`"writeOnly"`) genuinely **cannot read** —
 * it is reported as its own status rather than folded into `"denied"`, because
 * telling someone who granted write-only that they refused would be a lie.
 *
 * Your app must also ship the usage strings, or the OS denies every request
 * without ever prompting. The config plugin emits them from
 * `calendar: true` — off by default (M13 least privilege), like `healthKit`
 * and `push`.
 *
 * Every symbol used natively is watchOS 10.0 or below — exactly this package's
 * floor — so nothing here is version-gated. The deprecated
 * `requestAccess(to:completion:)` and `NSCalendarsUsageDescription` are
 * deliberately not used.
 */

/** Which entity a permission request is about. */
export type CalendarEntity = CalendarAccessRequest["entity"];

/**
 * What {@link requestCalendarAccess} resolves with.
 *
 * Only `"granted"` can read. `"writeOnly"` is a real watchOS 10 state — the
 * user allowed adding, not reading — and `"notDetermined"` means nobody has
 * asked yet, which is the only one worth prompting about again.
 */
export type CalendarAccessResult =
  | "granted"
  | "denied"
  | "restricted"
  | "notDetermined"
  | "writeOnly"
  | "unavailable";

/** One event occurrence in the requested window. */
export interface CalendarEvent {
  /**
   * `EKEvent.eventIdentifier` — **shared by every occurrence of a recurring
   * series**, so it is not unique in a multi-day window. Use `id + startMs` as
   * a React key.
   */
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  /** Absent when the event has no location. */
  location?: string;
  /** The calendar the event belongs to, e.g. "Work". */
  calendarTitle: string;
}

/** One incomplete reminder. */
export interface Reminder {
  /** `EKCalendarItem.calendarItemIdentifier` — unique per reminder. */
  id: string;
  title: string;
  /** Absent when the reminder has no due date at all (a real state, not a
   *  zero). */
  dueMs?: number;
  completed: boolean;
  calendarTitle: string;
}

/** Request for {@link getCalendarEvents}. */
export interface CalendarEventsQuery {
  /** Absolute ms since epoch. */
  startMs: number;
  /** Absolute ms since epoch. Must be after `startMs` — an inverted window
   *  rejects `INVALID_REQUEST` rather than resolving an empty list a caller
   *  cannot tell from "nothing scheduled". */
  endMs: number;
  /** Cap on events returned. Hard ceiling 250. */
  limit?: number;
}

/** Request for {@link getReminders}. */
export interface RemindersQuery {
  /** Only reminders due before this instant. Defaults to 30 days out —
   *  "everything incomplete, ever" is an unbounded query. */
  dueBeforeMs?: number;
  /** Cap on reminders returned. Hard ceiling 250. */
  limit?: number;
}

/**
 * Shows the EventKit permission sheet for one entity and reports the resulting
 * status. Once the user has answered, calling it again returns the standing
 * status **without** re-prompting, so this doubles as the status read.
 *
 * Ask for `"events"` and `"reminders"` separately — they are two independent
 * OS permissions, and an app that only shows a schedule should never ask for
 * reminders.
 */
export function requestCalendarAccess(
  entity: CalendarEntity,
): Promise<CalendarAccessResult> {
  // The sheet blocks on the user, which routinely outlasts the 30 s default
  // watchdog — the same reason purchase() and requestHealthAuthorization()
  // raise it. Missing this turns a granted permission into a spurious
  // rejection.
  return invoke<CalendarAccessResult>(
    "requestCalendarAccess",
    { entity },
    { timeoutMs: USER_MEDIATED_INVOKE_TIMEOUT_MS },
  );
}

/**
 * Events overlapping `[startMs, endMs)`, earliest first.
 *
 * Resolves `[]` for a window with nothing in it. Rejects `PERMISSION_DENIED`
 * when this app cannot read the calendar — including the write-only and
 * never-asked cases, whose messages say which one it is — and
 * `INVALID_REQUEST` for a malformed window.
 */
export function getCalendarEvents(
  request: CalendarEventsQuery,
): Promise<CalendarEvent[]> {
  return invoke<CalendarEvent[]>("getCalendarEvents", request);
}

/**
 * Incomplete reminders due before `dueBeforeMs` (default: 30 days out),
 * earliest first. Same empty-vs-denied split as {@link getCalendarEvents}.
 */
export function getReminders(
  request: RemindersQuery = {},
): Promise<Reminder[]> {
  return invoke<Reminder[]>("getReminders", request);
}
