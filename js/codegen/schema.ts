// Single source of truth for the JS<->Swift wire contract. `npm run codegen`
// renders this into Swift Codable models (watch + widget targets) and the
// TypeScript wire types, so the schema lives in exactly one place instead
// of being hand-synced across host.ts, NodeModel.swift and WidgetModels.swift.
//
// `swift`/`ts` on each field are explicit type strings (no inference) so the
// mapping is unambiguous. JSONValue and the node struct are fixed templates
// (special: a union enum and helper accessors); the rest are plain structs.

/** Which native runtime a method / struct targets (the widget is a subset). */
export type WireTarget = "watch" | "widget";
/** Direct-method argument scalar types that cross the C boundary. */
export type ArgType = "string" | "int" | "double";
/** Direct-method return types (`string?` is the nullable getItem return). */
export type ReturnType = "void" | "string?" | "int";

/** A component the React tree can emit + how the widget interpreter supports it. */
export interface Component {
  name: string;
  widget: "full" | "degraded";
}

/** One field of a generated struct. `swift` is absent for TS-only wire types. */
export interface StructField {
  name: string;
  swift?: string;
  ts: string;
  doc?: string;
  optional?: boolean;
}

/** A struct rendered to both a Swift Codable and a TS interface. */
export interface StructDef {
  swift: string;
  ts: string;
  doc?: string;
  targets?: WireTarget[];
  fields: StructField[];
  swiftComputed?: string[];
}

/** A wire type rendered to TS only (Swift emits these as calls, never decodes). */
export interface TsOnlyDef {
  ts: string;
  doc?: string;
  fields: StructField[];
}

/** One argument in a direct `__host` method signature. */
export interface HostArg {
  name: string;
  type: ArgType;
}

/** A `__host` bridge method (see the doc on `hostMethods`). */
export interface HostMethod {
  name: string;
  targets: WireTarget[];
  feature: string;
  since: number;
  doc?: string;
  /** `"invoke"` routes through the generic channel instead of a host function. */
  via?: string;
  /** Non-optional in the generated TS interface (JS assumes it's present). */
  tsRequired?: boolean;
  args?: HostArg[];
  returns?: ReturnType;
}

// The committed-tree wire version (SerializedTree.v / RNTree.v). Bump on ANY
// breaking change to the shared tree structs so the native runtime can detect
// a renderer-vs-runtime mismatch loudly instead of mis-decoding silently.
// Keep this in sync with the `v` field literal type in `structs` below.
export const wireVersion = 1;

// The JS<->Swift host *bridge* protocol version (ARCH-01), distinct from the
// tree wire version: bump when the bridge's call/transport shape changes. The
// native binary reports its bridgeProtocol + the set of features it provides;
// an OTA bundle's required features must be a subset of that (the capability
// gate that replaces a single scalar `hostApiVersion`).
export const bridgeProtocol = 1;

/** The node struct, named differently per side. */
export const node = { swift: "RNNode", ts: "SerializedNode" };

/**
 * The component contract (CX-024 / SD-6): every primitive type the React tree
 * can emit, and how the widget interpreter supports it — `full` (same as the
 * app) or `degraded` (a static/read-only stand-in, since WidgetKit views are
 * non-interactive). The app interpreter supports all of them fully.
 *
 * Single source of truth for the vocabulary. `component-contract.test` asserts
 * BOTH interpreters (ReactWatchHost/NodeView + the widget's WidgetNodeView) have
 * a `case` for every entry, so a primitive can't be handled in one and silently
 * dropped in the other (the CX-018 class of drift). The Swift switches keep a
 * `default:` (logs + skips, for forward-compat with newer bundles), so Swift
 * can't enforce this at compile time — hence the test.
 */
export const components: Component[] = [
  { name: "VStack", widget: "full" },
  { name: "HStack", widget: "full" },
  { name: "ZStack", widget: "full" },
  { name: "ScrollView", widget: "degraded" },
  { name: "List", widget: "degraded" },
  { name: "TabView", widget: "degraded" },
  { name: "Spacer", widget: "full" },
  { name: "Divider", widget: "full" },
  { name: "Text", widget: "full" },
  // degraded, not full: the `milliseconds` mode falls back to seconds in a
  // widget — WidgetKit timelines can't live-tick sub-second (see the widget
  // interpreter's timerText). Plain mm:ss timers render fully.
  { name: "TimerText", widget: "degraded" },
  // Locale-aware date/number text, formatted natively (i18n step 2) — pure
  // Text output, so the widget renders it fully.
  { name: "FormattedText", widget: "full" },
  { name: "Image", widget: "full" },
  { name: "Map", widget: "degraded" },
  { name: "Gauge", widget: "full" },
  { name: "ProgressView", widget: "full" },
  { name: "Button", widget: "degraded" },
  { name: "Toggle", widget: "degraded" },
  { name: "Slider", widget: "degraded" },
  { name: "Stepper", widget: "degraded" },
  { name: "Picker", widget: "degraded" },
  { name: "DatePicker", widget: "degraded" },
  { name: "TextField", widget: "degraded" },
  // Masked text entry; a widget shows only the placeholder (never a secret).
  { name: "SecureField", widget: "degraded" },
  { name: "CrownRotation", widget: "degraded" },
  { name: "NavigationStack", widget: "degraded" },
  { name: "NavigationLink", widget: "degraded" },
  { name: "NavigationRoute", widget: "degraded" },
  // Presentation surfaces (system-presented; widgets can't present -> degraded
  // to nothing) + grouping/label primitives.
  { name: "Alert", widget: "degraded" },
  { name: "AlertAction", widget: "degraded" },
  { name: "ConfirmationDialog", widget: "degraded" },
  { name: "Sheet", widget: "degraded" },
  { name: "Section", widget: "degraded" },
  { name: "Label", widget: "full" },
  // Layout/data-display vocabulary (watchOS 9/10 APIs within the v10 floor).
  { name: "Grid", widget: "full" },
  { name: "GridRow", widget: "full" },
  { name: "ShareLink", widget: "degraded" },
  { name: "Chart", widget: "full" },
  { name: "LabeledContent", widget: "full" },
  { name: "ContentUnavailable", widget: "full" },
  { name: "Toolbar", widget: "degraded" },
  { name: "ToolbarItem", widget: "degraded" },
];

/** Plain structs, rendered for both Swift and TS from `fields`. */
export const structs: StructDef[] = [
  {
    swift: "RNTree",
    ts: "SerializedTree",
    doc: "A committed UI tree. `seq` acks the highest processed event.",
    targets: ["watch"],
    fields: [
      { name: "v", swift: "Int", ts: "1" },
      { name: "seq", swift: "Int", ts: "number" },
      { name: "root", swift: `${node.swift}?`, ts: `${node.ts} | null` },
    ],
  },
  {
    swift: "PublishedRelevance",
    ts: "PublishedRelevance",
    targets: ["widget"],
    fields: [
      { name: "score", swift: "Double", ts: "number" },
      { name: "durationMs", swift: "Double?", ts: "number", optional: true },
    ],
  },
  {
    swift: "PublishedControl",
    ts: "PublishedControl",
    targets: ["widget"],
    fields: [
      { name: "intent", swift: "String", ts: "string" },
      { name: "label", swift: "String", ts: "string" },
      { name: "systemName", swift: "String?", ts: "string", optional: true },
    ],
  },
  {
    swift: "PublishedEntry",
    ts: "PublishedEntry",
    targets: ["widget"],
    fields: [
      { name: "date", swift: "Double", ts: "number", doc: "ms since epoch" },
      { name: "tree", swift: `${node.swift}?`, ts: `${node.ts} | null` },
      {
        name: "url",
        swift: "String?",
        ts: "string",
        optional: true,
      },
      {
        name: "relevance",
        swift: "PublishedRelevance?",
        ts: "PublishedRelevance",
        optional: true,
      },
    ],
    swiftComputed: [
      "var entryDate: Date { Date(timeIntervalSince1970: date / 1000) }",
    ],
  },
  {
    swift: "PublishedRelevantContext",
    ts: "PublishedRelevantContext",
    targets: ["widget"],
    fields: [
      { name: "date", swift: "Double?", ts: "number", optional: true },
      { name: "latitude", swift: "Double?", ts: "number", optional: true },
      { name: "longitude", swift: "Double?", ts: "number", optional: true },
      { name: "radius", swift: "Double?", ts: "number", optional: true },
    ],
  },
  {
    swift: "PublishedFamilyTimeline",
    ts: "PublishedFamilyTimeline",
    targets: ["widget"],
    fields: [
      { name: "entries", swift: "[PublishedEntry]", ts: "PublishedEntry[]" },
      { name: "reloadAfter", swift: "Double?", ts: "number", optional: true },
      {
        // Smart Stack relevance hints (date/location) so the watch surfaces
        // the widget at the right time/place.
        name: "relevantContexts",
        swift: "[PublishedRelevantContext]?",
        ts: "PublishedRelevantContext[]",
        optional: true,
      },
    ],
    swiftComputed: [
      "var reloadAfterDate: Date? {\n        reloadAfter.map { Date(timeIntervalSince1970: $0 / 1000) }\n    }",
    ],
  },
  {
    swift: "PublishedWidgets",
    ts: "PublishedWidgets",
    targets: ["widget"],
    fields: [
      { name: "v", swift: "Int", ts: "1" },
      { name: "publishedAt", swift: "Double", ts: "number" },
      {
        name: "widgets",
        swift: "[String: [String: PublishedFamilyTimeline]]",
        ts: "Record<string, Record<string, PublishedFamilyTimeline>>",
      },
      {
        // Swift optional (tolerates payloads predating controls); TS always
        // emits it. `optional` only drives the TS `?`; Swift uses the type.
        name: "controls",
        swift: "[String: PublishedControl]?",
        ts: "Record<string, PublishedControl>",
        optional: false,
      },
    ],
  },
];

/** TS-only wire type (Swift sends events as JS calls, never decodes them). */
export const tsOnly: TsOnlyDef[] = [
  {
    ts: "WatchEvent",
    fields: [
      { name: "nodeId", ts: "number" },
      { name: "event", ts: "string" },
      { name: "payload", ts: "Record<string, unknown>", optional: true },
      { name: "seq", ts: "number", optional: true },
    ],
  },
];

/**
 * The `__host` bridge surface. `targets` says which native runtime installs
 * each method (the widget extension is a subset); the cross-check test asserts
 * each side installs exactly its listed methods.
 *
 * `feature` is the stable capability id an OTA bundle gates on (ARCH-01): many
 * methods map to one feature (`getItem`+`setItem` -> "storage"); the "core"
 * feature is infra (commit/log/timers) that's always present with the
 * bridgeProtocol and isn't separately gateable. `since` is the bridgeProtocol
 * version a method first shipped in — the build derives a bundle's required
 * `minBridgeProtocol`/feature set from the methods it actually uses.
 *
 * `args`/`returns` are the method SIGNATURE (CX-023): the codegen generates the
 * whole synchronous bridge from them — the TS `QuickJSHostGlobal` interface, the
 * Swift `HostBridge` callbacks, the C trampolines, and the install table — so the
 * bridge is single-source and can't be hand-mis-wired. Arg/return types are
 * `string` | `int` | `double` (plus the `string?` nullable return for getItem).
 * Only DIRECT methods carry them; `via: "invoke"` methods are routed through the
 * generic invoke channel, not installed as host functions, so they have none.
 * `tsRequired` marks a method the JS assumes is always present when `__host`
 * exists (commit/log/setTimer) — non-optional in the generated TS interface.
 */
export const hostMethods: HostMethod[] = [
  // The widget runtime installs commit as a defensive no-op (intent mode
  // must not mount UI), so both runtimes install it.
  {
    name: "commit",
    targets: ["watch", "widget"],
    feature: "core",
    since: 1,
    tsRequired: true,
    args: [{ name: "treeJson", type: "string" }],
  },
  {
    name: "log",
    targets: ["watch", "widget"],
    feature: "core",
    since: 1,
    tsRequired: true,
    args: [{ name: "message", type: "string" }],
  },
  {
    name: "setTimer",
    targets: ["watch", "widget"],
    feature: "core",
    since: 1,
    tsRequired: true,
    args: [
      { name: "id", type: "int" },
      { name: "ms", type: "double" },
    ],
  },
  {
    name: "clearTimer",
    targets: ["watch", "widget"],
    feature: "core",
    since: 1,
    args: [{ name: "id", type: "int" }],
  },
  // The generic request/response channel (SD-1): fallible ops tagged
  // `via: "invoke"` below are NOT installed as their own host functions — they're
  // dispatched through invoke(id, method, payloadJson) and settled by
  // __resolveInvoke/__rejectInvoke. They keep their own `feature` (so the ARCH-01
  // capability set is unchanged); they're just routed through one channel instead
  // of a per-op global pair.
  {
    name: "invoke",
    targets: ["watch", "widget"],
    feature: "core",
    since: 1,
    doc: "Generic request/response channel for fallible ops (SD-1); settles via __resolveInvoke(id, resultJson) / __rejectInvoke(id, errorJson).",
    args: [
      { name: "id", type: "int" },
      { name: "method", type: "string" },
      { name: "payloadJson", type: "string" },
    ],
  },
  {
    name: "publishWidgets",
    targets: ["watch", "widget"],
    feature: "widgets",
    since: 1,
    doc: "Persists rendered widget timelines and reloads WidgetKit.",
    args: [{ name: "payloadJson", type: "string" }],
  },
  {
    name: "getItem",
    targets: ["watch", "widget"],
    feature: "storage",
    since: 1,
    doc: "App Group UserDefaults, shared between app and widget extension.",
    args: [{ name: "key", type: "string" }],
    returns: "string?",
  },
  {
    name: "setItem",
    targets: ["watch", "widget"],
    feature: "storage",
    since: 1,
    args: [
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
  },
  // Cross-process-atomic integer counters (ARCH-05): a clamped read-modify-write
  // that get/set can't do atomically across the app + widget-extension. Same
  // "storage" feature — no new capability, just a safe mutation primitive.
  {
    name: "counterGet",
    targets: ["watch", "widget"],
    feature: "storage",
    since: 1,
    doc: "Cross-process-atomic integer counters (ARCH-05): counterAdd does a clamped read-modify-write get/set can't do atomically across processes.",
    args: [{ name: "key", type: "string" }],
    returns: "int",
  },
  {
    name: "counterAdd",
    targets: ["watch", "widget"],
    feature: "storage",
    since: 1,
    args: [
      { name: "key", type: "string" },
      { name: "delta", type: "int" },
      { name: "min", type: "int" },
      { name: "max", type: "int" },
    ],
    returns: "int",
  },
  {
    name: "playHaptic",
    targets: ["watch"],
    feature: "haptics",
    since: 1,
    args: [{ name: "type", type: "string" }],
  },
  {
    name: "requestNotificationPermission",
    targets: ["watch"],
    feature: "notifications",
    since: 1,
    via: "invoke",
  },
  {
    name: "scheduleNotification",
    targets: ["watch"],
    feature: "notifications",
    since: 1,
    via: "invoke",
  },
  {
    name: "cancelNotification",
    targets: ["watch"],
    feature: "notifications",
    since: 1,
    args: [{ name: "id", type: "string" }],
  },
  // Remote push (APNs) is its OWN feature, not "notifications": HostPolicy
  // treats each feature as an authorization unit (ARCH-07), and a consumer
  // allowing local notifications must not implicitly allow remote push —
  // registration talks to Apple's servers and hands out a routable token.
  {
    name: "registerForRemoteNotifications",
    targets: ["watch"],
    feature: "push",
    since: 1,
    via: "invoke",
  },
  {
    name: "sendToPhone",
    targets: ["watch"],
    feature: "connectivity",
    since: 1,
    via: "invoke",
  },
  {
    name: "updateApplicationContext",
    targets: ["watch"],
    feature: "connectivity",
    since: 1,
    via: "invoke",
  },
  {
    name: "transferUserInfo",
    targets: ["watch"],
    feature: "connectivity",
    since: 1,
    via: "invoke",
  },
  {
    name: "fetch",
    targets: ["watch"],
    feature: "network",
    since: 1,
    args: [
      { name: "id", type: "int" },
      { name: "requestJson", type: "string" },
    ],
  },
  {
    name: "abortFetch",
    targets: ["watch"],
    feature: "network",
    since: 1,
    args: [{ name: "id", type: "int" }],
  },
  {
    name: "ble",
    targets: ["watch"],
    feature: "bluetooth",
    since: 1,
    doc: "Fire-and-forget BLE op channel — now only `disconnect`; connect/write/subscribe settle via invoke (bleConnect/bleWrite/bleSubscribe).",
    args: [{ name: "json", type: "string" }],
  },
  // BLE connect/write/subscribe settle their result through invoke (CX-022): a
  // failed connect or unacked write was invisible on the fire-and-forget `ble`
  // channel. Same `bluetooth` feature; the onBleState/onBleNotify push channel
  // and `disconnect` (above) are unchanged.
  {
    name: "bleConnect",
    targets: ["watch"],
    feature: "bluetooth",
    since: 1,
    via: "invoke",
  },
  {
    name: "bleWrite",
    targets: ["watch"],
    feature: "bluetooth",
    since: 1,
    via: "invoke",
  },
  {
    name: "bleSubscribe",
    targets: ["watch"],
    feature: "bluetooth",
    since: 1,
    via: "invoke",
  },
  {
    name: "sensor",
    targets: ["watch"],
    feature: "sensors",
    since: 1,
    args: [{ name: "json", type: "string" }],
  },
  {
    name: "saveUpdate",
    targets: ["watch"],
    feature: "ota",
    since: 1,
    via: "invoke",
  },
  // OTA observability (review §6.11b): which bundle is actually running —
  // source/version/keyId/expiresAt + the device's anti-rollback high-water —
  // so an app can ship fleet telemetry, making the staleness/freeze monitoring
  // that docs/ota-signing.md recommends actually implementable.
  {
    name: "getUpdateState",
    targets: ["watch"],
    feature: "ota",
    since: 1,
    via: "invoke",
  },
  // ARCH-04's explicit `bundleReady`: the bundle confirming, after its own
  // smoke checks, that this launch is healthy. Inert unless the app configured
  // `OTAConfig(healthSignal: .explicit)` — under the default `.firstCommit` the
  // first committed tree already blessed the bundle and this is a no-op.
  // watch-only: the widget renders the known-good record and never counts boot
  // attempts, so it has nothing to confirm.
  {
    name: "markUpdateHealthy",
    targets: ["watch"],
    feature: "ota",
    since: 1,
    via: "invoke",
  },
  {
    name: "generate",
    targets: ["watch"],
    feature: "ai",
    since: 1,
    args: [
      { name: "id", type: "int" },
      { name: "requestJson", type: "string" },
    ],
  },
  // Runtime "can this watch run on-device AI now?" query (CX-002), distinct from
  // the build-time `ai` feature: a watch on the right OS may still be unable
  // (model not downloaded / Apple Intelligence off). Routed via invoke.
  {
    name: "aiAvailability",
    targets: ["watch"],
    feature: "ai",
    since: 1,
    via: "invoke",
  },
  // --- Device info (WKInterfaceDevice): a snapshot query; battery + wrist
  //     changes stream on the push channel (device.battery / device.wrist). ---
  {
    name: "getDeviceInfo",
    targets: ["watch"],
    feature: "device",
    since: 1,
    via: "invoke",
  },
  {
    name: "enableWaterLock",
    targets: ["watch"],
    feature: "device",
    since: 1,
    via: "invoke",
  },
  // --- Background app refresh: schedule a wake-up; the fire arrives on the
  //     push channel as `backgroundRefresh`. ---
  {
    name: "scheduleBackgroundRefresh",
    targets: ["watch"],
    feature: "background",
    since: 1,
    via: "invoke",
  },
  // --- Extended runtime session (WKExtendedRuntimeSession): keep running
  //     briefly after backgrounding; state on `runtimeSession.*` push events. ---
  {
    name: "startExtendedRuntimeSession",
    targets: ["watch"],
    feature: "runtime",
    since: 1,
    via: "invoke",
  },
  {
    name: "stopExtendedRuntimeSession",
    targets: ["watch"],
    feature: "runtime",
    since: 1,
    via: "invoke",
  },
  // --- Keychain secure storage (Security framework), distinct from Storage's
  //     App-Group UserDefaults: for tokens/secrets. ---
  {
    name: "keychainSet",
    targets: ["watch"],
    feature: "keychain",
    since: 1,
    via: "invoke",
  },
  {
    name: "keychainGet",
    targets: ["watch"],
    feature: "keychain",
    since: 1,
    via: "invoke",
  },
  {
    name: "keychainDelete",
    targets: ["watch"],
    feature: "keychain",
    since: 1,
    via: "invoke",
  },
  // --- Speech synthesis (AVSpeechSynthesizer): speak/stop; completion on the
  //     push channel as `speech.finished`. ---
  {
    name: "speak",
    targets: ["watch"],
    feature: "speech",
    since: 1,
    via: "invoke",
  },
  {
    name: "stopSpeaking",
    targets: ["watch"],
    feature: "speech",
    since: 1,
    via: "invoke",
  },
  // --- Audio playback (AVAudioPlayer over AVAudioSession .playback):
  //     play a sound from an https URL; completion on `audio.finished`. ---
  {
    name: "playAudio",
    targets: ["watch"],
    feature: "audio",
    since: 1,
    via: "invoke",
  },
  {
    name: "stopAudio",
    targets: ["watch"],
    feature: "audio",
    since: 1,
    via: "invoke",
  },
  // --- In-app purchase (StoreKit 2). ---
  {
    name: "getProducts",
    targets: ["watch"],
    feature: "iap",
    since: 1,
    via: "invoke",
  },
  {
    name: "purchase",
    targets: ["watch"],
    feature: "iap",
    since: 1,
    via: "invoke",
  },
  {
    name: "currentEntitlements",
    targets: ["watch"],
    feature: "iap",
    since: 1,
    via: "invoke",
  },
  {
    name: "restorePurchases",
    targets: ["watch"],
    feature: "iap",
    since: 1,
    via: "invoke",
  },
  // --- MapKit local POI search (MKLocalSearch): a natural-language query +
  //     region -> nearby places, for the searchable Map. Fallible + async, so
  //     routed via invoke. ---
  {
    name: "searchPOI",
    targets: ["watch"],
    feature: "location",
    since: 1,
    via: "invoke",
  },
  // One-shot current location (CLLocationManager.requestLocation): a single
  // {lat, lon} fix, for centering a map / biasing a POI search. Prompts for
  // When-In-Use authorization if undetermined; rejects if denied.
  {
    name: "getCurrentLocation",
    targets: ["watch"],
    feature: "location",
    since: 1,
    via: "invoke",
  },
];
