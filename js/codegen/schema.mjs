// Single source of truth for the JS<->Swift wire contract. `npm run codegen`
// renders this into Swift Codable models (watch + widget targets) and the
// TypeScript wire types, so the schema lives in exactly one place instead
// of being hand-synced across host.ts, NodeModel.swift and WidgetModels.swift.
//
// `swift`/`ts` on each field are explicit type strings (no inference) so the
// mapping is unambiguous. JSONValue and the node struct are fixed templates
// (special: a union enum and helper accessors); the rest are plain structs.

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
export const components = [
  { name: "VStack", widget: "full" },
  { name: "HStack", widget: "full" },
  { name: "ZStack", widget: "full" },
  { name: "ScrollView", widget: "degraded" },
  { name: "List", widget: "degraded" },
  { name: "TabView", widget: "degraded" },
  { name: "Spacer", widget: "full" },
  { name: "Divider", widget: "full" },
  { name: "Text", widget: "full" },
  { name: "TimerText", widget: "full" },
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
  { name: "CrownRotation", widget: "degraded" },
  { name: "NavigationStack", widget: "degraded" },
  { name: "NavigationLink", widget: "degraded" },
  { name: "NavigationRoute", widget: "degraded" },
];

/** Plain structs, rendered for both Swift and TS from `fields`. */
export const structs = [
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
export const tsOnly = [
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
 */
export const hostMethods = [
  // The widget runtime installs commit as a defensive no-op (intent mode
  // must not mount UI), so both runtimes install it.
  { name: "commit", targets: ["watch", "widget"], feature: "core", since: 1 },
  { name: "log", targets: ["watch", "widget"], feature: "core", since: 1 },
  { name: "setTimer", targets: ["watch", "widget"], feature: "core", since: 1 },
  {
    name: "clearTimer",
    targets: ["watch", "widget"],
    feature: "core",
    since: 1,
  },
  // The generic request/response channel (SD-1): fallible ops tagged
  // `via: "invoke"` below are NOT installed as their own host functions — they're
  // dispatched through invoke(id, method, payloadJson) and settled by
  // __resolveInvoke/__rejectInvoke. They keep their own `feature` (so the ARCH-01
  // capability set is unchanged); they're just routed through one channel instead
  // of a per-op global pair.
  { name: "invoke", targets: ["watch", "widget"], feature: "core", since: 1 },
  {
    name: "publishWidgets",
    targets: ["watch", "widget"],
    feature: "widgets",
    since: 1,
  },
  {
    name: "getItem",
    targets: ["watch", "widget"],
    feature: "storage",
    since: 1,
  },
  {
    name: "setItem",
    targets: ["watch", "widget"],
    feature: "storage",
    since: 1,
  },
  { name: "playHaptic", targets: ["watch"], feature: "haptics", since: 1 },
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
  },
  {
    name: "sendToPhone",
    targets: ["watch"],
    feature: "connectivity",
    since: 1,
    via: "invoke",
  },
  { name: "fetch", targets: ["watch"], feature: "network", since: 1 },
  { name: "abortFetch", targets: ["watch"], feature: "network", since: 1 },
  { name: "ble", targets: ["watch"], feature: "bluetooth", since: 1 },
  { name: "sensor", targets: ["watch"], feature: "sensors", since: 1 },
  {
    name: "saveUpdate",
    targets: ["watch"],
    feature: "ota",
    since: 1,
    via: "invoke",
  },
  { name: "generate", targets: ["watch"], feature: "ai", since: 1 },
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
];
