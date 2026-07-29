import type { ReactNode } from "react";
import type { HostBridge, QuickJSHostGlobal, SerializedTree } from "./host";
import { dispatchNativeEvent } from "./nativeEvents";
import { WatchRoot } from "./renderer";

export type { GenerateOptions } from "./ai";
export { generateText, isOnDeviceAIAvailable } from "./ai";
export type { ScenePhase } from "./appState";
export {
  LUMINANCE_REDUCED_EVENT,
  onLuminanceReduced,
  onScenePhase,
  SCENE_PHASE_EVENT,
} from "./appState";
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
export type { BleConnectOptions, BleState, BleWriteOptions } from "./bluetooth";
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
  CalendarAccessResult,
  CalendarEntity,
  CalendarEvent,
  CalendarEventsQuery,
  Reminder,
  RemindersQuery,
} from "./calendar";
export {
  getCalendarEvents,
  getReminders,
  requestCalendarAccess,
} from "./calendar";
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
  SecureFieldProps,
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
  SecureField,
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
export type {
  ConnectivityState,
  FileTransferHandle,
  FileTransferResult,
  FileTransferStatus,
  MessageContract,
  ReceivedFile,
  ReceivedFileChunk,
  TypedMessages,
} from "./connectivity";
export {
  APPLICATION_CONTEXT_EVENT,
  CONNECTIVITY_STATE_EVENT,
  cancelFileTransfer,
  defineMessages,
  deleteReceivedFile,
  FILE_TRANSFER_EVENT,
  getConnectivityState,
  onApplicationContext,
  onConnectivityState,
  onFileTransfer,
  onPhoneMessage,
  onReceivedFile,
  onUserInfo,
  outstandingFileTransfers,
  PHONE_MESSAGE_EVENT,
  RECEIVED_FILE_EVENT,
  readReceivedFile,
  sendToPhone,
  transferFile,
  transferUserInfo,
  USER_INFO_EVENT,
  updateApplicationContext,
} from "./connectivity";
export type { DeviceInfo } from "./device";
export { enableWaterLock, getDeviceInfo } from "./device";
export type {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticSubsystem,
} from "./diagnostics";
export { DIAGNOSTIC_EVENT, onDiagnostic } from "./diagnostics";
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
export type { PedometerData } from "./generated/wire";
export { WIRE_VERSION } from "./generated/wire";
export type { HapticType } from "./haptics";
export { playHaptic } from "./haptics";
export type {
  HealthAuthorizationOptions,
  HealthAuthorizationResult,
  HealthQuantityType,
  HealthSample,
  HealthSamplesQuery,
  HealthStatistic,
  HealthStatisticsQuery,
  HealthStatisticsResult,
  SleepSample,
  SleepSamplesQuery,
  SleepStage,
} from "./health";
export {
  queryHealthDailyStatistics,
  queryHealthSamples,
  queryHealthStatistics,
  querySleepSamples,
  requestHealthAuthorization,
} from "./health";
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
export type {
  RemotePushAps,
  RemotePushNotification,
} from "./remotePush";
export {
  onRemotePush,
  onRemotePushRegistrationError,
  onRemotePushToken,
  REMOTE_PUSH_EVENT,
  REMOTE_PUSH_REGISTRATION_ERROR_EVENT,
  REMOTE_PUSH_TOKEN_EVENT,
  registerForRemoteNotifications,
} from "./remotePush";
export { type DispatchResult, WatchRoot } from "./renderer";
export type {
  HeartRateOptions,
  LocationOptions,
  MotionOptions,
  PedometerOptions,
  SensorKind,
} from "./sensors";
export {
  queryPedometer,
  SENSOR_EVENT_PREFIX,
  startGyroscope,
  startHeartRate,
  startLocation,
  startMotion,
  startPedometer,
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
  markUpdateHealthy,
  type UpdateManifest,
  type UpdateState,
} from "./update";
export type {
  ControlDefinition,
  EntryRelevance,
  FitnessCondition,
  HeadphonesCondition,
  InferredLocation,
  PoiCategory,
  PublishedWidgets,
  RelevantContext,
  RelevantDateKind,
  SleepCondition,
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
export type {
  StartWorkoutOptions,
  WorkoutActivityType,
  WorkoutMetrics,
  WorkoutState,
} from "./workout";
export {
  endWorkout,
  getWorkoutState,
  onWorkoutMetrics,
  onWorkoutState,
  pauseWorkout,
  resumeWorkout,
  startWorkout,
  WORKOUT_METRICS_EVENT,
  WORKOUT_STATE_EVENT,
} from "./workout";

/**
 * ARCH-08: the one root `runApp` has mounted and not yet disposed. A second
 * `runApp` used to silently supersede the first — it overwrote the three
 * globals so native reached only the new root, while the old one stayed
 * mounted, kept its listeners in the shared `nativeEvents` table and kept
 * committing into its stale host. Superseding silently is the bug; throwing is
 * the fix (rule 12). Auto-disposing the predecessor was the alternative and
 * was rejected: it makes a genuine double-mount look like it worked.
 */
let activeRoot: WatchRoot | null = null;

/**
 * Mounts the app. With an explicit host (tests), trees are delivered as
 * objects. Without one (on the watch), the `__host` global installed by
 * JSRuntime.swift receives JSON strings, and `__dispatchEvent` is exposed
 * for Swift to deliver interactions.
 *
 * One root at a time: call `root.dispose()` before mounting another — it
 * unmounts the tree (running every effect cleanup) and uninstalls the four
 * globals below. On the watch a reload never needs it (`boot()` builds a whole
 * new QuickJS context, so every global and every module binding resets by
 * construction); in tests it is what keeps sequential mounts from leaking into
 * each other.
 */
export function runApp(element: ReactNode, host?: HostBridge): WatchRoot {
  if (activeRoot !== null) {
    throw new Error(
      "runApp: a root is already mounted — call root.dispose() first",
    );
  }
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
  // The four globals are captured as named closures, not assigned inline, so
  // dispose() can uninstall exactly the functions it installed (identity
  // check below) instead of clobbering a successor root's.
  //
  // `root` is referenced before its declaration on purpose: these are only
  // ever CALLED after runApp returns, by which point the binding is
  // initialized. Mirrors the stopFn === stop pattern in inspector.ts.
  //
  // Returns the structured DispatchResult as a JSON string (ARCH-09) — the
  // navigation transaction's synchronous verdict. A thrown handler propagates
  // out instead of returning, which Swift's parse maps to a rollback.
  const dispatchEvent = (
    nodeId: number,
    event: string,
    payloadJson?: string,
    seq?: number,
  ): string => {
    const payload = payloadJson ? JSON.parse(payloadJson) : undefined;
    return JSON.stringify(
      root.dispatchEvent(
        seq === undefined
          ? { nodeId, event, payload }
          : { nodeId, event, payload, seq },
      ),
    );
  };
  // Native state pushes: run the listener at urgent priority + flush so it
  // commits instantly (like a tap), not on the scheduler's next turn.
  const pushNativeEvent = (name: string, payloadJson?: string): boolean =>
    root.runSync(() =>
      dispatchNativeEvent(
        name,
        payloadJson ? JSON.parse(payloadJson) : undefined,
      ),
    );
  // Debug inspector: returns the current serialized tree + commit count.
  const inspect = () => root.inspect();
  // Native teardown hook: lets Swift dispose the live root before it evaluates
  // ANOTHER bundle into the same QuickJS context. `activeRoot` lives in this
  // module's IIFE scope (esbuild format:"iife"), so a re-evaluation gets a
  // FRESH module scope on a context whose globals persist — the single-root
  // guard above cannot see the previous evaluation's root, and the OTA→shipped
  // fallback (OTABootSequencer) would otherwise leave the failed bundle's tree
  // mounted with its sensors/listeners still live.
  const disposeRoot = () => root.dispose();
  const root = new WatchRoot(bridge, () => {
    // Identity-checked: only remove a global that still points at THIS root's
    // closure. Belt-and-braces against the single-root guard — a root created
    // directly (`new WatchRoot`) or a late dispose() must never uninstall the
    // live root's entry points.
    if (g.__dispatchEvent === dispatchEvent) delete g.__dispatchEvent;
    if (g.__pushNativeEvent === pushNativeEvent) delete g.__pushNativeEvent;
    if (g.__inspect === inspect) delete g.__inspect;
    if (g.__disposeActiveRoot === disposeRoot) delete g.__disposeActiveRoot;
    if (activeRoot === root) activeRoot = null;
  });
  g.__dispatchEvent = dispatchEvent;
  g.__pushNativeEvent = pushNativeEvent;
  g.__inspect = inspect;
  g.__disposeActiveRoot = disposeRoot;
  activeRoot = root;
  try {
    root.render(element);
  } catch (error) {
    // The first render threw: release the single-root slot and uninstall the
    // globals this call installed, so the NEXT runApp reports its own failure
    // instead of "a root is already mounted". The original error still
    // propagates.
    root.dispose();
    throw error;
  }
  return root;
}
