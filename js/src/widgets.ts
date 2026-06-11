import type { ReactNode } from "react";
import type { QuickJSHostGlobal, SerializedNode } from "./host";
import { MemoryHost } from "./host";
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

export interface WidgetTimelineEntry {
  date: number | Date;
  view: ReactNode;
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
}

export interface PublishedFamilyTimeline {
  entries: PublishedEntry[];
  reloadAfter?: number;
}

export interface PublishedWidgets {
  v: 1;
  publishedAt: number;
  widgets: Record<string, Record<string, PublishedFamilyTimeline>>;
}

const registry = new Map<string, WidgetDefinition>();

export function registerWidget(definition: WidgetDefinition): void {
  registry.set(definition.kind, definition);
}

export function unregisterAllWidgets(): void {
  registry.clear();
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

/** Renders every registered widget for every family it supports. */
export function renderWidgets(now: number = Date.now()): PublishedWidgets {
  const widgets: PublishedWidgets["widgets"] = {};
  for (const definition of registry.values()) {
    const byFamily: Record<string, PublishedFamilyTimeline> = {};
    for (const family of definition.families) {
      const timeline = definition.render({ family, now });
      byFamily[family] = {
        entries: timeline.entries.map((entry) => ({
          date: toMs(entry.date),
          tree: renderToTree(entry.view),
        })),
        ...(timeline.reloadAfter !== undefined
          ? { reloadAfter: toMs(timeline.reloadAfter) }
          : {}),
      };
    }
    widgets[definition.kind] = byFamily;
  }
  return { v: 1, publishedAt: now, widgets };
}

/**
 * Renders all widgets and hands the payload to the native host, which
 * persists it to App Group storage and calls
 * WidgetCenter.reloadAllTimelines(). Returns the payload (tests inspect
 * it; a missing host method is fine on platforms without widgets).
 */
export function publishWidgets(now: number = Date.now()): PublishedWidgets {
  const payload = renderWidgets(now);
  const host = (globalThis as { __host?: QuickJSHostGlobal }).__host;
  host?.publishWidgets?.(JSON.stringify(payload));
  return payload;
}
