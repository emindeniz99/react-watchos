import type { ReactNode } from "react";
import type { HostBridge, QuickJSHostGlobal, SerializedTree } from "./host";
import { WatchRoot } from "./renderer";
import { dispatchNativeEvent } from "./nativeEvents";

export {
  VStack,
  HStack,
  Text,
  Button,
  Toggle,
  Spacer,
  Image,
  ZStack,
  ScrollView,
  List,
  Divider,
  Gauge,
  ProgressView,
  NavigationStack,
  NavigationLink,
  TextField,
  Picker,
  TabView,
  TimerText,
  CrownRotation,
  Slider,
  Stepper,
  DatePicker,
  MapView,
} from "./components";
export type {
  VStackProps,
  HStackProps,
  TextProps,
  ButtonProps,
  ToggleProps,
  SpacerProps,
  ImageProps,
  ZStackProps,
  ScrollViewProps,
  ListProps,
  DividerProps,
  GaugeProps,
  ProgressViewProps,
  NavigationStackProps,
  NavigationLinkProps,
  TextFieldProps,
  PickerProps,
  TabViewProps,
  TimerTextProps,
  CrownRotationProps,
  SliderProps,
  StepperProps,
  DatePickerProps,
  MapProps,
  MapAnnotation,
} from "./components";
export {
  registerNativeListener,
  unregisterAllNativeListeners,
  dispatchNativeEvent,
} from "./nativeEvents";
export type { NativeEventHandler } from "./nativeEvents";
export {
  sendToPhone,
  onPhoneMessage,
  PHONE_MESSAGE_EVENT,
} from "./connectivity";
export {
  bleConnect,
  bleDisconnect,
  bleWrite,
  bleSubscribe,
  onBleState,
  onBleNotify,
  BLE_STATE_EVENT,
  BLE_NOTIFY_EVENT,
} from "./bluetooth";
export type { BleState } from "./bluetooth";
export {
  startSensor,
  stopSensor,
  startHeartRate,
  startMotion,
  SENSOR_EVENT_PREFIX,
} from "./sensors";
export type { SensorKind } from "./sensors";
export { ErrorBoundary } from "./errorBoundary";
export { Headers } from "./fetch";
export { playHaptic } from "./haptics";
export type { HapticType } from "./haptics";
export {
  requestNotificationPermission,
  scheduleNotification,
  cancelNotification,
} from "./notifications";
export type { NotificationRequest } from "./notifications";
export {
  registerWidget,
  registerControl,
  unregisterAllWidgets,
  renderToTree,
  renderWidgets,
  publishWidgets,
} from "./widgets";
export type {
  WidgetFamily,
  WidgetRenderContext,
  WidgetTimeline,
  WidgetTimelineEntry,
  WidgetDefinition,
  ControlDefinition,
  EntryRelevance,
  PublishedWidgets,
} from "./widgets";
export { Storage } from "./storage";
export {
  registerIntent,
  unregisterAllIntents,
  handleIntent,
} from "./intents";
export type { IntentHandler } from "./intents";
export { applyUpdate } from "./update";
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
    seq?: number,
  ): boolean =>
    root.dispatchEvent({
      nodeId,
      event,
      payload: payloadJson ? JSON.parse(payloadJson) : undefined,
      seq,
    });
  // Native state pushes: run the listener at urgent priority + flush so it
  // commits instantly (like a tap), not on the scheduler's next turn.
  g.__pushNativeEvent = (name: string, payloadJson?: string): boolean =>
    root.runSync(() =>
      dispatchNativeEvent(
        name,
        payloadJson ? JSON.parse(payloadJson) : undefined,
      ),
    );
  // Debug inspector: returns the current serialized tree + commit count.
  g.__inspect = () => root.inspect();
  root.render(element);
  return root;
}
