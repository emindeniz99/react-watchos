import type { ReactNode } from "react";
import type { HostBridge, QuickJSHostGlobal, SerializedTree } from "./host";
import { WatchRoot } from "./renderer";

export {
  VStack,
  HStack,
  Text,
  Button,
  Toggle,
  Spacer,
  Image,
} from "./components";
export type {
  VStackProps,
  HStackProps,
  TextProps,
  ButtonProps,
  ToggleProps,
  SpacerProps,
  ImageProps,
} from "./components";
export { MemoryHost } from "./host";
export type {
  HostBridge,
  SerializedNode,
  SerializedTree,
  WatchEvent,
} from "./host";
export { WatchRoot } from "./renderer";

/**
 * Mounts the app. With an explicit host (tests), trees are delivered as
 * objects. Without one (on the watch), the `__host` global installed by
 * JSRuntime.swift receives JSON strings, and `__dispatchEvent` is exposed
 * for Swift to deliver interactions.
 */
export function runApp(element: ReactNode, host?: HostBridge): WatchRoot {
  const g = globalThis as Record<string, unknown> & {
    __host?: QuickJSHostGlobal;
  };
  let bridge = host;
  if (!bridge) {
    const native = g.__host;
    if (!native) {
      throw new Error("runApp: no host given and no __host global installed");
    }
    bridge = {
      commit: (tree: SerializedTree) => native.commit(JSON.stringify(tree)),
      log: (message: string) => native.log(message),
    };
  }
  const root = new WatchRoot(bridge);
  g.__dispatchEvent = (
    nodeId: number,
    event: string,
    payloadJson?: string,
  ): boolean =>
    root.dispatchEvent({
      nodeId,
      event,
      payload: payloadJson ? JSON.parse(payloadJson) : undefined,
    });
  root.render(element);
  return root;
}
