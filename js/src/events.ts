import type { WatchEvent } from "./host";
import { normalizeRoute } from "./navigation";
import type { Instance } from "./renderer";

const eventToProp: Record<string, string> = {
  press: "onPress",
  longPress: "onLongPress",
  change: "onChange",
  pathChange: "onPathChange",
  swipe: "onSwipe",
  swipeAction: "onSwipeAction",
  leadingSwipeAction: "onLeadingSwipeAction",
  drag: "onDrag",
};

/** Calls the matching handler prop on a live instance. */
export function dispatchToInstance(
  instance: Instance,
  event: WatchEvent,
): boolean {
  const propName = eventToProp[event.event];
  if (!propName) return false;
  const handler = instance.props[propName];
  if (typeof handler !== "function") return false;
  if (event.event === "change") {
    handler(event.payload?.value);
  } else if (event.event === "pathChange") {
    handler(event.payload?.path);
  } else if (event.event === "swipe") {
    handler(event.payload?.direction);
  } else {
    handler(event.payload);
  }
  return true;
}

/**
 * ARCH-09 acceptance for a `pathChange` proposal, computed AFTER the dispatch
 * flush: a controlled stack accepted the navigation iff the path it committed
 * (its `path` prop, normalized the way the native stack normalizes) now equals
 * the proposed path — so the handler must fold synchronously. An uncontrolled
 * stack (no `path` prop) has nothing to compare — the NavigationStack wrapper
 * always folds native's report into local state — so acceptance is simply
 * "the handler ran"; the same fallback covers a malformed proposal.
 */
export function pathChangeAccepted(
  instance: Instance | undefined,
  handled: boolean,
  payload: WatchEvent["payload"],
): boolean {
  const committed = normalizedStack(instance?.props.path);
  const proposed = normalizedStack(payload?.path);
  if (committed === null || proposed === null) return handled;
  return (
    committed.length === proposed.length &&
    committed.every((route, i) => route === proposed[i])
  );
}

/** A path as native's `normalized([String])` sees it — "/"-prefixed, "/"
 *  entries dropped — or null when it isn't a string array (an uncontrolled
 *  stack's absent `path` prop, an unknown node, a garbage payload). */
function normalizedStack(path: unknown): string[] | null {
  if (!Array.isArray(path)) return null;
  const stack: string[] = [];
  for (const entry of path) {
    if (typeof entry !== "string") return null;
    const route = normalizeRoute(entry);
    if (route !== "/") stack.push(route);
  }
  return stack;
}
