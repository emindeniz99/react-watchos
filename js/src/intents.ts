import { storageWrites } from "./storage";
import { publishWidgets } from "./widgets";

/**
 * App Intent handlers written in React-land. WidgetKit Controls (Control
 * Center / Action button) run an AppIntent in the widget extension; the
 * extension evaluates the bundle with `__entrypoint = "intent"` and calls
 * `__handleIntent(name)`, so the same JS that renders the widgets also
 * handles the interaction. A handler just mutates `Storage`; the runtime
 * reloads the widgets for it (see handleIntent) — it must NOT call
 * `publishWidgets()` itself.
 */

export type IntentHandler = (params?: Record<string, unknown>) => void;

const intents = new Map<string, IntentHandler>();

export function registerIntent(name: string, handler: IntentHandler): void {
  intents.set(name, handler);
}

export function unregisterAllIntents(): void {
  intents.clear();
}

/**
 * Dispatches an intent and auto-reloads the widgets the Glance way: if the
 * handler changed persisted state (any `Storage` write), the runtime
 * re-renders + reloads the timelines so the tap can't silently no-op — the
 * author never calls `publishWidgets()` and so can't forget to. A handler that
 * wrote nothing doesn't reload, so a no-op intent never spends the WidgetKit
 * reload budget; and the single publish here coalesces multiple writes into
 * one reload per dispatch. Returns false for unknown intents so native can
 * log, not crash.
 */
export function handleIntent(name: string, paramsJson?: string): boolean {
  const handler = intents.get(name);
  if (!handler) return false;
  const writesBefore = storageWrites();
  handler(paramsJson ? JSON.parse(paramsJson) : undefined);
  if (storageWrites() !== writesBefore) publishWidgets();
  return true;
}

// Entry point for Swift (IntentRuntime in the widget extension).
(globalThis as Record<string, unknown>).__handleIntent = (
  name: string,
  paramsJson?: string,
): boolean => handleIntent(name, paramsJson);
