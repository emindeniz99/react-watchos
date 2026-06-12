import type { ReactNode } from "react";
import type { SerializedNode } from "./host";
import { MemoryHost, getHost } from "./host";
import { WatchRoot } from "./renderer";

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
  relevance?: EntryRelevance;
}

export interface WidgetTimeline {
  entries: WidgetTimelineEntry[];
  /** Ask WidgetKit to re-publish after this time (ms or Date). */
  reloadAfter?: number | Date;
}

export interface WidgetDefinition {
  /** Matches the WidgetKit `kind` in the Swift widget extension. */
  kind: string;
  families: WidgetFamily[];
  render: (context: WidgetRenderContext) => WidgetTimeline;
}

export interface PublishedEntry {
  date: number;
  tree: SerializedNode | null;
  relevance?: EntryRelevance;
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

export interface PublishedFamilyTimeline {
  entries: PublishedEntry[];
  reloadAfter?: number;
}

export interface PublishedWidgets {
  v: 1;
  publishedAt: number;
  widgets: Record<string, Record<string, PublishedFamilyTimeline>>;
  controls: Record<string, Omit<ControlDefinition, "kind">>;
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

let renderingWidgets = false;

/** Renders every registered widget for every family it supports. */
export function renderWidgets(now: number = Date.now()): PublishedWidgets {
  renderingWidgets = true;
  try {
    return renderWidgetsInner(now);
  } finally {
    renderingWidgets = false;
  }
}

function renderWidgetsInner(now: number): PublishedWidgets {
  const widgets: PublishedWidgets["widgets"] = {};
  for (const definition of registry.values()) {
    const byFamily: Record<string, PublishedFamilyTimeline> = {};
    for (const family of definition.families) {
      const timeline = definition.render({ family, now });
      byFamily[family] = {
        entries: timeline.entries.map((entry) => ({
          date: toMs(entry.date),
          tree: renderToTree(entry.view),
          ...(entry.relevance ? { relevance: entry.relevance } : {}),
        })),
        ...(timeline.reloadAfter !== undefined
          ? { reloadAfter: toMs(timeline.reloadAfter) }
          : {}),
      };
    }
    widgets[definition.kind] = byFamily;
  }
  const controls: PublishedWidgets["controls"] = {};
  for (const { kind, ...metadata } of controlRegistry.values()) {
    controls[kind] = metadata;
  }
  return { v: 1, publishedAt: now, widgets, controls };
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
    return { v: 1, publishedAt: now, widgets: {}, controls: {} };
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
