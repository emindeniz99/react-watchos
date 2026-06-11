import type { WatchEvent } from "./host";
import type { Instance } from "./renderer";

const eventToProp: Record<string, string> = {
  press: "onPress",
  change: "onChange",
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
  } else {
    handler(event.payload);
  }
  return true;
}
