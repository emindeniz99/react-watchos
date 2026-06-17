// Single source of truth for the JS<->Swift wire contract. `npm run codegen`
// renders this into Swift Codable models (watch + widget targets) and the
// TypeScript wire types, so the schema lives in exactly one place instead
// of being hand-synced across host.ts, NodeModel.swift and WidgetModels.swift.
//
// `swift`/`ts` on each field are explicit type strings (no inference) so the
// mapping is unambiguous. JSONValue and the node struct are fixed templates
// (special: a union enum and helper accessors); the rest are plain structs.

/** The node struct, named differently per side. */
export const node = { swift: "RNNode", ts: "SerializedNode" };

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
 * each method (the widget extension is a subset). The cross-check test
 * asserts each side installs exactly its listed methods.
 */
export const hostMethods = [
  // The widget runtime installs commit as a defensive no-op (intent mode
  // must not mount UI), so both runtimes install it.
  { name: "commit", targets: ["watch", "widget"] },
  { name: "log", targets: ["watch", "widget"] },
  { name: "setTimer", targets: ["watch", "widget"] },
  { name: "clearTimer", targets: ["watch", "widget"] },
  { name: "publishWidgets", targets: ["watch", "widget"] },
  { name: "getItem", targets: ["watch", "widget"] },
  { name: "setItem", targets: ["watch", "widget"] },
  { name: "playHaptic", targets: ["watch"] },
  { name: "requestNotificationPermission", targets: ["watch"] },
  { name: "scheduleNotification", targets: ["watch"] },
  { name: "cancelNotification", targets: ["watch"] },
  { name: "sendToPhone", targets: ["watch"] },
  { name: "fetch", targets: ["watch"] },
  { name: "abortFetch", targets: ["watch"] },
  { name: "ble", targets: ["watch"] },
  { name: "sensor", targets: ["watch"] },
  { name: "saveUpdate", targets: ["watch"] },
  { name: "generate", targets: ["watch"] },
];
