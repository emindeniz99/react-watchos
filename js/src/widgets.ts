import type { ReactNode } from "react";
import type {
  PublishedFamilyTimeline,
  PublishedRelevantContext,
  PublishedWidgets,
} from "./generated/wire";
import type { SerializedNode } from "./host";
import { getHost, MemoryHost } from "./host";
import { WatchRoot } from "./renderer";

export type {
  PublishedEntry,
  PublishedFamilyTimeline,
  PublishedWidgets,
} from "./generated/wire";

/**
 * React-rendered WidgetKit timelines (watch complications and Smart Stack
 * widgets). Widget extensions are not long-running processes, so the
 * watch app's React instance renders timelines ahead of time and
 * publishes them through __host.publishWidgets; the widget extension
 * (targets/widget) decodes the stored payload and renders it natively.
 * This is Apple's "keep your complications up to date" model with React
 * as the timeline author.
 */

export type WidgetFamily =
  | "accessoryCircular"
  | "accessoryRectangular"
  | "accessoryInline"
  | "accessoryCorner";

export interface WidgetRenderContext {
  family: WidgetFamily;
  /** Timeline render time, ms since epoch. */
  now: number;
  /**
   * For a widget with `instances`, the id of the instance being rendered.
   * The published key is `kind/instanceId`, which a configurable widget's
   * native provider looks up from the user's per-complication selection.
   */
  instanceId?: string;
}

export interface EntryRelevance {
  /** Smart Stack relevance score (higher = more prominent). */
  score: number;
  /** How long the score applies, in ms. */
  durationMs?: number;
}

export interface WidgetTimelineEntry {
  date: number | Date;
  view: ReactNode;
  /** Optional deep link opened when the complication/widget is tapped. */
  url?: string;
  relevance?: EntryRelevance;
}

/**
 * How the system should treat a date clue (RelevanceKit `DateKind`,
 * watchOS 26.0). Omit to let RelevanceKit pick — the older, kind-less
 * `date(_:)` overload (watchOS 10.0) is used then, so a watch below 26 still
 * gets the hint.
 */
export type RelevantDateKind = "default" | "informational" | "scheduled";

/** RelevanceKit `InferredLocation` (watchOS 10.0) — a place the system infers
 *  for the user, no coordinates or geofence needed. */
export type InferredLocation = "home" | "work" | "school" | "commute";

/** RelevanceKit `FitnessCondition` (watchOS 10.0). */
export type FitnessCondition = "activityRingsIncomplete" | "workoutActive";

/** RelevanceKit `SleepCondition` (watchOS 10.0). */
export type SleepCondition = "bedtime" | "wakeup";

/** RelevanceKit `HeadphonesCondition` (watchOS 10.0). Single-member today;
 *  a union so a future condition is additive, not breaking. */
export type HeadphonesCondition = "connected";

/**
 * A MapKit point-of-interest category, mirroring the Swift member names of
 * `MKPointOfInterestCategory` (watchOS 6.0+ for the oldest members; the
 * `poi` clue that consumes them is watchOS 26.0). 73 of the 84 documented
 * members: the 11 in MapKit's "Type Properties" group (`airportTerminal`,
 * `scenicView`, `visitorCenter`, …) are watchOS 27.0 **beta** and are
 * deliberately excluded — declaring a value the current SDK can't compile is
 * the CX-002/FoundationModels mistake.
 *
 * Member NAMES, not raw values: `MKPointOfInterestCategory`'s rawValue is an
 * undocumented Objective-C constant (`MKPOICategory…`), so the Swift side maps
 * these names to the static members explicitly rather than round-tripping
 * through `MKPointOfInterestCategory(rawValue:)`. A name this library doesn't
 * know drops the hint instead of fabricating a category.
 */
export type PoiCategory =
  // Arts and culture
  | "museum"
  | "musicVenue"
  | "theater"
  // Education
  | "library"
  | "planetarium"
  | "school"
  | "university"
  // Entertainment
  | "movieTheater"
  | "nightlife"
  // Health and safety
  | "fireStation"
  | "hospital"
  | "pharmacy"
  | "police"
  // Historical and cultural landmarks
  | "castle"
  | "fortress"
  | "landmark"
  | "nationalMonument"
  // Food and drink
  | "bakery"
  | "brewery"
  | "cafe"
  | "distillery"
  | "foodMarket"
  | "restaurant"
  | "winery"
  // Personal services
  | "animalService"
  | "atm"
  | "automotiveRepair"
  | "bank"
  | "beauty"
  | "evCharger"
  | "fitnessCenter"
  | "laundry"
  | "mailbox"
  | "postOffice"
  | "restroom"
  | "spa"
  | "store"
  // Parks and recreation
  | "amusementPark"
  | "aquarium"
  | "beach"
  | "campground"
  | "fairground"
  | "marina"
  | "nationalPark"
  | "park"
  | "rvPark"
  | "zoo"
  // Sports
  | "baseball"
  | "basketball"
  | "bowling"
  | "goKart"
  | "golf"
  | "hiking"
  | "miniGolf"
  | "rockClimbing"
  | "skatePark"
  | "skating"
  | "skiing"
  | "soccer"
  | "stadium"
  | "tennis"
  | "volleyball"
  // Travel
  | "airport"
  | "carRental"
  | "conventionCenter"
  | "gasStation"
  | "hotel"
  | "parking"
  | "publicTransport"
  // Water sports
  | "fishing"
  | "kayaking"
  | "surfing"
  | "swimming";

/**
 * A Smart Stack **predictive** clue: when/where the system should surface this
 * widget at all. Distinct from {@link EntryRelevance}, which ranks a widget the
 * stack is already showing.
 *
 * Clues are metadata for the on-device ranker — publishing one costs a few
 * bytes at render time and zero wakeups, CPU or radio at surface time, which is
 * why this is the one relevance surface worth widening on a battery-first
 * library.
 *
 * A tagged union, not the old positional `{date?, latitude?, …}` bag: the
 * RelevanceKit surface has eight clue families that share no fields, and a
 * discriminant is the only shape that can carry a POI category, an inferred
 * place, or a fitness/sleep/headphones condition at all.
 *
 * Availability is per-arm and handled natively: `poi` and any `dateKind` need
 * watchOS 26.0 and are dropped below it (`@available` gate in
 * `reactRelevantContext`); the other six families are watchOS 10.0 — the
 * package's own floor — so they work on every supported watch.
 */
export type RelevantContext =
  /** Surface near an exact moment. */
  | { kind: "date"; date: number | Date; dateKind?: RelevantDateKind }
  /** Surface across a closed date range. */
  | {
      kind: "dateRange";
      from: number | Date;
      to: number | Date;
      dateKind?: RelevantDateKind;
    }
  /** Surface inside a geofence (radius in meters, default 100). */
  | { kind: "location"; latitude: number; longitude: number; radius?: number }
  /** Surface near any point of interest of this category (watchOS 26.0). */
  | { kind: "poi"; category: PoiCategory }
  /** Surface at a place the system infers, with no coordinates of our own. */
  | { kind: "inferredLocation"; place: InferredLocation }
  | { kind: "fitness"; condition: FitnessCondition }
  | { kind: "sleep"; condition: SleepCondition }
  | { kind: "headphones"; condition: HeadphonesCondition };

export interface WidgetTimeline {
  entries: WidgetTimelineEntry[];
  /** Ask WidgetKit to re-publish after this time (ms or Date). */
  reloadAfter?: number | Date;
  /** Smart Stack predictive clues — when/where to surface this widget. */
  relevantContexts?: RelevantContext[];
}

export interface WidgetDefinition {
  /** Matches the WidgetKit `kind` in the Swift widget extension. */
  kind: string;
  families: WidgetFamily[];
  render: (context: WidgetRenderContext) => WidgetTimeline;
  /**
   * Optional: expand this widget into one timeline per instance id, published
   * under the key `kind/id` (instead of just `kind`). Use for a configurable
   * widget whose native AppIntentConfiguration picks an instance per
   * complication — e.g. one shopping list per id. `render` then receives the
   * id as `context.instanceId`.
   */
  instances?: () => string[];
}

/**
 * Metadata for a WidgetKit Control (watchOS 26 Control Center / Action
 * button). Controls are templated by the OS — a symbol plus a label, not
 * a free-form view — so React authors the metadata and handles the
 * control's AppIntent via registerIntent.
 */
export interface ControlDefinition {
  /** WidgetKit control kind, e.g. "hydration.addGlass". */
  kind: string;
  /** Intent name dispatched back into JS when the control is used. */
  intent: string;
  label: string;
  systemName?: string;
  /**
   * `ControlWidgetButton`'s second label, shown while the action runs
   * ("Adding…" next to a "Add Glass" label). Ignored by a toggle.
   */
  actionLabel?: string;
  /**
   * Current on/off state for a `ControlWidgetToggle`. **Presence marks this
   * control a toggle**: a control that publishes no `value` is a button, and
   * the native `reactControlToggle` returns nil for it rather than letting a
   * consumer render a toggle whose `isOn` nobody publishes.
   *
   * Prefer the GETTER form. `registerControl` is called once, but a toggle's
   * state changes every time the user flips it — a literal `boolean` is
   * captured at registration and would publish that first value forever, so the
   * control would draw itself as stuck. A `() => boolean` is called on every
   * publish, exactly like `WidgetDefinition.render`. A literal stays supported
   * for genuinely constant state.
   *
   * This supplies a Swift-declared toggle's STATE; it cannot turn a
   * `ControlWidgetButton` into a `ControlWidgetToggle` — those are different
   * types in the consumer's `@main` bundle (see `registerControl`).
   */
  value?: boolean | (() => boolean);
}

const registry = new Map<string, WidgetDefinition>();
const controlRegistry = new Map<string, ControlDefinition>();

export function registerWidget(definition: WidgetDefinition): void {
  registry.set(definition.kind, definition);
}

/**
 * Publishes metadata for a control the consumer has ALREADY declared in Swift.
 *
 * `registerControl` **re-labels a control; it cannot create one.** A
 * `ControlWidget` is a static Swift type inside the widget extension's `@main`
 * `WidgetBundle`, and its `kind` and `AppIntent` are compiled in — so JS can
 * supply the label, symbol, action label and toggle state that the Swift side
 * reads back through `reactControlMetadata`/`reactControlToggle`, but a `kind`
 * with no matching Swift declaration shows up nowhere. Whether a control is a
 * button or a toggle is likewise a Swift-side choice of template.
 *
 * This is the same inherent constraint as widget `kind`s, not a defect: WidgetKit
 * discovers controls from the bundle's static type list, which exists before any
 * JS runs.
 */
export function registerControl(definition: ControlDefinition): void {
  controlRegistry.set(definition.kind, definition);
}

export function unregisterAllWidgets(): void {
  registry.clear();
  controlRegistry.clear();
}

/** One-shot render: element in, serialized tree out. No host, no events. */
export function renderToTree(element: ReactNode): SerializedNode | null {
  const host = new MemoryHost();
  const root = new WatchRoot(host);
  try {
    root.render(element);
    return host.lastCommit?.root ?? null;
  } finally {
    root.unmount();
  }
}

function toMs(value: number | Date): number {
  return value instanceof Date ? value.getTime() : value;
}

/**
 * WidgetKit budgets complication reloads to roughly a few dozen a day, so it
 * never honors a sub-few-minute cadence literally — but a tiny/past
 * `reloadAfter` still wastes budget, and every honored reload re-renders the
 * tree in the extension (a QuickJS pass). Floor author-supplied values
 * defensively and warn (fail-loud) when we clamp, rather than forwarding a
 * runaway cadence verbatim to native.
 */
const MIN_RELOAD_AFTER_MS = 5 * 60 * 1000;

function flooredReloadAfter(value: number | Date, now: number): number {
  const requested = toMs(value);
  const floor = now + MIN_RELOAD_AFTER_MS;
  if (requested < floor) {
    getHost()?.log?.(
      `[react-watch-widget] reloadAfter ${requested} is below the ` +
        `${MIN_RELOAD_AFTER_MS}ms floor; clamped to ${floor}`,
    );
    return floor;
  }
  return requested;
}

/**
 * Flattens one clue onto the wire: the discriminant plus only that arm's
 * fields. The Swift side switches on `kind` and reads exactly the fields that
 * arm carries, so an absent field is never ambiguous with a defaulted one.
 */
function publishedRelevantContext(
  c: RelevantContext,
): PublishedRelevantContext {
  switch (c.kind) {
    case "date":
      return {
        kind: c.kind,
        date: toMs(c.date),
        ...(c.dateKind !== undefined ? { dateKind: c.dateKind } : {}),
      };
    case "dateRange":
      return {
        kind: c.kind,
        from: toMs(c.from),
        to: toMs(c.to),
        ...(c.dateKind !== undefined ? { dateKind: c.dateKind } : {}),
      };
    case "location":
      return {
        kind: c.kind,
        latitude: c.latitude,
        longitude: c.longitude,
        ...(c.radius !== undefined ? { radius: c.radius } : {}),
      };
    case "poi":
      return { kind: c.kind, category: c.category };
    case "inferredLocation":
      return { kind: c.kind, place: c.place };
    // One `condition` slot for the three condition families — `kind` already
    // says which enum it names, so three near-identical fields would only give
    // the wire a way to disagree with itself.
    case "fitness":
    case "sleep":
    case "headphones":
      return { kind: c.kind, condition: c.condition };
  }
}

let renderingWidgets = false;

/**
 * The App-Group state revision this render derives from (ARCH-06). Sampled at
 * RENDER START — before any `render()` callback reads Storage. Sampling at the
 * END would stamp "current" over data read before the write: the exact bug
 * ARCH-06 closes.
 *
 * Sampling early is necessary but not sufficient. What makes "a write that
 * lands mid-render leaves the payload stamped with the OLDER revision" actually
 * true is that the SAMPLE ITSELF closes the native mutation batch: the rule is
 * "the revision moves on the first write after the last sample-or-publication",
 * not "…since the last publication". Without that, a mid-render write landing
 * inside a batch some earlier write had already opened would bump nothing, and
 * the payload would be stamped equal to the live revision — reading `.current`
 * over state it was computed before.
 *
 * The one deliberate exception is the widget extension's render-only pass,
 * where the payload being stamped owns its own `render()`-time writes (see
 * WidgetIntentRuntime.armRenderOnlyBatch) — otherwise such a bundle would boot
 * the engine on every timeline request forever.
 *
 * 0 where the host has no storage bridge (tests, Node).
 */
function sampleStateRevision(): number {
  return getHost()?.stateRevision?.() ?? 0;
}

/** The content id of the bundle producing this payload (CX-025's
 *  `__bundleReleaseId`). undefined when the runtime booted precompiled
 *  bytecode with no source to hash — "producer unknown", which never makes a
 *  consumer reject the payload. */
function bundleReleaseId(): string | undefined {
  const id = (globalThis as { __bundleReleaseId?: unknown }).__bundleReleaseId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/** Renders every registered widget for every family it supports. */
export function renderWidgets(now: number = Date.now()): PublishedWidgets {
  // Sampled BEFORE the guard is raised: a host whose `stateRevision` throws
  // (any consumer- or test-supplied `__host`) would otherwise skip the
  // `finally` and leave `renderingWidgets` true for the life of the process,
  // making every later publishWidgets() a silent no-op that logs the wrong
  // cause. Nothing may throw between raising the flag and entering the try.
  const stateRevision = sampleStateRevision();
  renderingWidgets = true;
  try {
    return renderWidgetsInner(now, stateRevision);
  } finally {
    renderingWidgets = false;
  }
}

function renderWidgetsInner(
  now: number,
  stateRevision: number,
): PublishedWidgets {
  const widgets: PublishedWidgets["widgets"] = {};
  for (const definition of registry.values()) {
    // Isolate each kind: one widget's instances()/render() throwing must not
    // abort publishing the others — that would silently drop healthy
    // complications, and via the intent auto-reload path (a successful Storage
    // write → publishWidgets) leave the buffered mutation unpublished. Same
    // per-item isolation the native-event dispatcher uses.
    try {
      // A plain widget renders one timeline under `kind`; an `instances` widget
      // renders one per id under `kind/id` (undefined → the plain `kind` key).
      const instanceIds = definition.instances?.() ?? [undefined];
      for (const instanceId of instanceIds) {
        const byFamily: Record<string, PublishedFamilyTimeline> = {};
        for (const family of definition.families) {
          const timeline = definition.render({
            family,
            now,
            ...(instanceId !== undefined ? { instanceId } : {}),
          });
          byFamily[family] = {
            entries: timeline.entries.map((entry) => ({
              date: toMs(entry.date),
              tree: renderToTree(entry.view),
              ...(entry.url ? { url: entry.url } : {}),
              ...(entry.relevance ? { relevance: entry.relevance } : {}),
            })),
            ...(timeline.reloadAfter !== undefined
              ? { reloadAfter: flooredReloadAfter(timeline.reloadAfter, now) }
              : {}),
            ...(timeline.relevantContexts
              ? {
                  relevantContexts: timeline.relevantContexts.map(
                    publishedRelevantContext,
                  ),
                }
              : {}),
          };
        }
        const key =
          instanceId === undefined
            ? definition.kind
            : `${definition.kind}/${instanceId}`;
        widgets[key] = byFamily;
      }
    } catch (error) {
      console.log(
        `[react-watch-widget] render failed for "${definition.kind}":`,
        error,
      );
    }
  }
  const controls: PublishedWidgets["controls"] = {};
  for (const { kind, value, ...metadata } of controlRegistry.values()) {
    // Same per-item isolation the widget loop uses, for the same reason: a
    // `value()` getter runs consumer code (it reads Storage), and one throwing
    // getter must not drop every OTHER control's label from the payload.
    try {
      const resolved = typeof value === "function" ? value() : value;
      controls[kind] = {
        ...metadata,
        ...(resolved !== undefined ? { value: resolved } : {}),
      };
    } catch (error) {
      console.log(
        `[react-watch-widget] control metadata failed for "${kind}":`,
        error,
      );
    }
  }
  return stamped(now, stateRevision, widgets, controls);
}

/** Assembles a payload with its ARCH-06 provenance stamps. Every payload the
 *  library emits goes through here, so the empty recursion-guard payload and a
 *  real render can't drift into different wire shapes. */
function stamped(
  now: number,
  stateRevision: number,
  widgets: PublishedWidgets["widgets"],
  controls: PublishedWidgets["controls"],
): PublishedWidgets {
  const releaseId = bundleReleaseId();
  return {
    v: 1,
    publishedAt: now,
    stateRevision,
    ...(releaseId !== undefined ? { releaseId } : {}),
    widgets,
    controls,
  };
}

/**
 * Renders all widgets and hands the payload to the native host, which
 * persists it to App Group storage and calls
 * WidgetCenter.reloadAllTimelines(). Returns the payload (tests inspect
 * it; a missing host method is fine on platforms without widgets).
 */
export function publishWidgets(now: number = Date.now()): PublishedWidgets {
  // A widget render() callback calling publishWidgets would recurse and,
  // worse, trigger WidgetCenter reload -> getTimeline -> render again — an
  // infinite reload loop in the extension. Ignore the call entirely.
  if (renderingWidgets) {
    getHost()?.log?.(
      "publishWidgets called inside a widget render; ignored to avoid a reload loop",
    );
    return stamped(now, sampleStateRevision(), {}, {});
  }
  const payload = renderWidgets(now);
  getHost()?.publishWidgets?.(JSON.stringify(payload));
  return payload;
}

// Entry point for the widget extension's TimelineProvider: render fresh
// timelines on demand (e.g. while the app stays closed) without
// publishing back through the host.
(globalThis as Record<string, unknown>).__renderWidgets = (
  now?: number,
): string => JSON.stringify(renderWidgets(now ?? Date.now()));

// ARCH-06 reconciliation entry point: the host calls this when the published
// payload's `stateRevision` no longer matches the App Group's — a mutation
// committed without a publication reaching the store (the app was killed
// between the two, or an extension write raced the app's). JS owns the render,
// so native asks rather than fabricating a payload. Separate from
// __renderWidgets because reconciliation must PUBLISH (persist + reload
// WidgetKit), not just return timelines.
(globalThis as Record<string, unknown>).__republishWidgets = (): void => {
  publishWidgets();
};
