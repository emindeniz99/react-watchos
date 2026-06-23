import type { WatchEvent } from "./host";
import type { Instance } from "./renderer";

const eventToProp: Record<string, string> = {
  press: "onPress",
  longPress: "onLongPress",
  change: "onChange",
  pathChange: "onPathChange",
  swipe: "onSwipe",
  swipeAction: "onSwipeAction",
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
