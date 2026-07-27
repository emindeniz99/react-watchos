import type { ReactNode } from "react";
import type {
  PublishedFamilyTimeline,
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

/** A Smart Stack relevance hint: surface near this time and/or place. */
export interface RelevantContext {
  date?: number | Date;
  latitude?: number;
  longitude?: number;
  /** Geofence radius in meters. */
  radius?: number;
}

export interface WidgetTimeline {
  entries: WidgetTimelineEntry[];
  /** Ask WidgetKit to re-publish after this time (ms or Date). */
  reloadAfter?: number | Date;
  /** Smart Stack date/location relevance hints. */
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
}

const registry = new Map<string, WidgetDefinition>();
const controlRegistry = new Map<string, ControlDefinition>();

export function registerWidget(definition: WidgetDefinition): void {
  registry.set(definition.kind, definition);
}

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

let renderingWidgets = false;

/**
 * The App-Group state revision this render derives from (ARCH-06). Sampled at
 * RENDER START — before any `render()` callback reads Storage — so a write that
 * lands mid-render leaves the payload stamped with the OLDER revision and a
 * consumer detects it as stale. Sampling at the END would stamp "current" over
 * data read before the write: the exact bug ARCH-06 closes. 0 where the host
 * has no storage bridge (tests, Node, a policy that denied `storage`).
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
  renderingWidgets = true;
  const stateRevision = sampleStateRevision();
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
                  relevantContexts: timeline.relevantContexts.map((c) => ({
                    ...(c.date !== undefined ? { date: toMs(c.date) } : {}),
                    ...(c.latitude !== undefined
                      ? { latitude: c.latitude }
                      : {}),
                    ...(c.longitude !== undefined
                      ? { longitude: c.longitude }
                      : {}),
                    ...(c.radius !== undefined ? { radius: c.radius } : {}),
                  })),
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
  for (const { kind, ...metadata } of controlRegistry.values()) {
    controls[kind] = metadata;
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
