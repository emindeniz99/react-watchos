/**
 * App Intent handlers written in React-land. WidgetKit Controls (Control
 * Center / Action button) run an AppIntent in the widget extension; the
 * extension evaluates the bundle with `__entrypoint = "intent"` and calls
 * `__handleIntent(name)`, so the same JS that renders the widgets also
 * handles the interaction (typically: mutate Storage, publishWidgets()).
 */

export type IntentHandler = (params?: Record<string, unknown>) => void;

const intents = new Map<string, IntentHandler>();

export function registerIntent(name: string, handler: IntentHandler): void {
  intents.set(name, handler);
}

export function unregisterAllIntents(): void {
  intents.clear();
}

/** Returns false for unknown intents so native can log, not crash. */
export function handleIntent(name: string, paramsJson?: string): boolean {
  const handler = intents.get(name);
  if (!handler) return false;
  handler(paramsJson ? JSON.parse(paramsJson) : undefined);
  return true;
}

// Entry point for Swift (IntentRuntime in the widget extension).
(globalThis as Record<string, unknown>).__handleIntent = (
  name: string,
  paramsJson?: string,
): boolean => handleIntent(name, paramsJson);
