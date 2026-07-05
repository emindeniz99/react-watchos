import type { ReactNode } from "react";
import type { HostBridge, QuickJSHostGlobal, SerializedTree } from "./host";
import { dispatchNativeEvent } from "./nativeEvents";
import { WatchRoot } from "./renderer";

export type { GenerateOptions } from "./ai";
export { generateText, isOnDeviceAIAvailable } from "./ai";
export type { PlayAudioOptions } from "./audio";
export {
  AUDIO_FINISHED_EVENT,
  onAudioFinished,
  playAudio,
  stopAudio,
} from "./audio";
export {
  BACKGROUND_REFRESH_EVENT,
  onBackgroundRefresh,
  scheduleBackgroundRefresh,
} from "./background";
export type { BleState, BleWriteOptions } from "./bluetooth";
export {
  BLE_NOTIFY_EVENT,
  BLE_STATE_EVENT,
  bleConnect,
  bleDisconnect,
  bleSubscribe,
  bleWrite,
  onBleNotify,
  onBleState,
} from "./bluetooth";
export type {
  AlertActionProps,
  AlertProps,
  ButtonProps,
  ChartPoint,
  ChartProps,
  ColorValue,
  ConfirmationDialogProps,
  ContentUnavailableProps,
  CrownRotationProps,
  DatePickerProps,
  DividerProps,
  FormattedTextProps,
  GaugeProps,
  GridProps,
  GridRowProps,
  HStackProps,
  ImageProps,
  LabeledContentProps,
  LabelProps,
  ListProps,
  MapAnnotation,
  MapProps,
  NavigationLinkProps,
  NavigationRouteProps,
  NavigationStackProps,
  PickerProps,
  ProgressViewProps,
  ScrollViewProps,
  SectionProps,
  ShareLinkProps,
  SheetProps,
  SliderProps,
  SpacerProps,
  StepperProps,
  SwipeActionProps,
  SystemColorName,
  TabViewProps,
  TextFieldProps,
  TextProps,
  TimerTextProps,
  ToggleProps,
  ToolbarItemProps,
  ToolbarProps,
  VStackProps,
  ZStackProps,
} from "./components";
export {
  Alert,
  AlertAction,
  Button,
  Chart,
  ConfirmationDialog,
  ContentUnavailable,
  CrownRotation,
  DatePicker,
  Divider,
  FormattedText,
  Gauge,
  Grid,
  GridRow,
  HStack,
  Image,
  Label,
  LabeledContent,
  List,
  MapView,
  NavigationLink,
  Picker,
  ProgressView,
  ScrollView,
  Section,
  ShareLink,
  Sheet,
  Slider,
  Spacer,
  Stepper,
  TabView,
  Text,
  TextField,
  TimerText,
  Toggle,
  Toolbar,
  ToolbarItem,
  VStack,
  ZStack,
} from "./components";
export type { MessageContract, TypedMessages } from "./connectivity";
export {
  defineMessages,
  onPhoneMessage,
  PHONE_MESSAGE_EVENT,
  sendToPhone,
} from "./connectivity";
export type { DeviceInfo } from "./device";
export { enableWaterLock, getDeviceInfo } from "./device";
export { ErrorBoundary } from "./errorBoundary";
export {
  onRuntimeSessionState,
  onRuntimeSessionWillExpire,
  RUNTIME_STATE_EVENT,
  RUNTIME_WILL_EXPIRE_EVENT,
  startExtendedRuntimeSession,
  stopExtendedRuntimeSession,
} from "./extendedRuntime";
export { Headers } from "./fetch";
export { WIRE_VERSION } from "./generated/wire";
export type { HapticType } from "./haptics";
export { playHaptic } from "./haptics";
export type {
  HostBridge,
  QuickJSHostGlobal,
  SerializedNode,
  SerializedTree,
  WatchEvent,
} from "./host";
export { getHost, MemoryHost } from "./host";
export type {
  Message,
  MessageTable,
  PluralCategory,
  PluralForms,
  PluralRule,
  TranslationConfig,
  TranslationParams,
  Translations,
} from "./i18n";
export {
  cldrPluralRule,
  createTranslations,
  englishPluralRule,
  TranslationProvider,
  useTranslation,
} from "./i18n";
export type { IAPProduct, PurchaseResult } from "./iap";
export {
  currentEntitlements,
  getProducts,
  purchase,
  restorePurchases,
} from "./iap";
export type { InspectorError, InspectorOptions } from "./inspector";
export {
  captureError,
  captureLog,
  inspectorSnapshot,
  startInspector,
  stopInspector,
} from "./inspector";
export type { IntentHandler } from "./intents";
export {
  handleIntent,
  registerIntent,
  unregisterAllIntents,
} from "./intents";
export { Keychain } from "./keychain";
export type { Coordinate, POIResult, POISearchOptions } from "./maps";
export { getCurrentLocation, searchPOI } from "./maps";
export type { NativeEventHandler, Unsubscribe } from "./nativeEvents";
export {
  dispatchNativeEvent,
  registerNativeListener,
  unregisterAllNativeListeners,
} from "./nativeEvents";
export type {
  NavigateOptions,
  NavigationAction,
  NavigationContextValue,
  NavigationProviderProps,
  ParamsOf,
  RouteMatch,
  RouteParams,
  RouteParamValue,
} from "./navigation";
export {
  deepLinkURL,
  getURLScheme,
  href,
  matchRoute,
  NavigationProvider,
  NavigationRoute,
  NavigationStack,
  normalizeRoute,
  OPEN_URL_EVENT,
  routeFromURL,
  useCanGoBack,
  useFocusEffect,
  useIsFocused,
  useNavigate,
  useNavigation,
  useParams,
  useRoute,
} from "./navigation";
export type {
  NotificationRequest,
  ScheduleNotificationResult,
} from "./notifications";
export {
  cancelNotification,
  requestNotificationPermission,
  scheduleNotification,
} from "./notifications";
export { WatchRoot } from "./renderer";
export type { SensorKind } from "./sensors";
export {
  SENSOR_EVENT_PREFIX,
  startGyroscope,
  startHeartRate,
  startLocation,
  startMotion,
  startSensor,
  stopSensor,
} from "./sensors";
export type { SpeakOptions } from "./speech";
export {
  onSpeechFinished,
  SPEECH_FINISHED_EVENT,
  speak,
  stopSpeaking,
} from "./speech";
export { Storage } from "./storage";
export type { TextVariant, ThemeOverrides, WatchTheme } from "./theme";
export { createTheme, defaultTheme, ThemeProvider, useTheme } from "./theme";
export {
  applyUpdate,
  BUNDLE_VERSION,
  checkForUpdate,
  fetchAndApplyUpdate,
  getUpdateState,
  type UpdateManifest,
  type UpdateState,
} from "./update";
export type {
  ControlDefinition,
  EntryRelevance,
  PublishedWidgets,
  WidgetDefinition,
  WidgetFamily,
  WidgetRenderContext,
  WidgetTimeline,
  WidgetTimelineEntry,
} from "./widgets";
export {
  publishWidgets,
  registerControl,
  registerWidget,
  renderToTree,
  renderWidgets,
  unregisterAllWidgets,
} from "./widgets";

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
      commit: (tree: SerializedTree, json?: string) =>
        native.commit(json ?? JSON.stringify(tree)),
      log: (message: string) => native.log(message),
    };
  }
  const root = new WatchRoot(bridge);
  g.__dispatchEvent = (
    nodeId: number,
    event: string,
    payloadJson?: string,
    seq?: number,
  ): boolean => {
    const payload = payloadJson ? JSON.parse(payloadJson) : undefined;
    return root.dispatchEvent(
      seq === undefined
        ? { nodeId, event, payload }
        : { nodeId, event, payload, seq },
    );
  };
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
