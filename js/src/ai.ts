import { getHost } from "./host";
import { invoke } from "./invoke";
import { registerNativeListener } from "./nativeEvents";

/**
 * On-device AI via Apple's Foundation Models framework — the ~3B-parameter
 * model behind Apple Intelligence. `generateText(prompt)` bridges to a native
 * `LanguageModelSession`; `generateObject(prompt, schema)` adds guided
 * generation against a JSON-Schema-subset (`DynamicGenerationSchema`
 * natively). Runs entirely on device (no network), so it works on a
 * standalone watch.
 *
 * Async like fetch: `__host.generate(id, requestJson)` starts a session;
 * Swift settles it via `__resolveGenerate(id, text)` /
 * `__rejectGenerate(id, errorJson)` where errorJson is `{code, message}`
 * (the invoke channel's typed-reject discipline, on this channel's own wire).
 * A streaming request additionally receives cumulative `ai.partial` pushes on
 * the native-event channel between call and settle, and
 * `__host.cancelGenerate(id)` stops the model mid-decode (the `abortFetch`
 * idiom — see {@link GenerateOptions.signal}).
 *
 * Requires watchOS 27+ (Foundation Models reached the watch at 27.0, in
 * beta); below it — or when the model isn't available right now — the native
 * side rejects `UNAVAILABLE`, so guard calls with
 * {@link isOnDeviceAIAvailable} or handle the rejection.
 */

/**
 * The closed set of codes an AI generation may reject with — the TS half of
 * `AIErrorCode` in ReactWatchSupport (AIPlan.swift), same discipline as
 * `InvokeErrorCode`. `ABORTED` and `TIMEOUT` are minted on this side (the
 * abort signal, the inactivity watchdog); everything else arrives from
 * native, mapped from FoundationModels' `GenerationError` cases.
 */
export type AIErrorCode =
  | "UNAVAILABLE"
  | "GUARDRAIL_VIOLATION"
  | "CONTEXT_WINDOW_EXCEEDED"
  | "UNSUPPORTED_LANGUAGE"
  | "DECODING_FAILURE"
  | "RATE_LIMITED"
  | "CONCURRENT_REQUESTS"
  | "REFUSAL"
  | "INVALID_SCHEMA"
  | "ABORTED"
  | "TIMEOUT"
  | "INTERNAL";

/** Error thrown by a rejected generation; `code` is machine-switchable.
 *  An aborted generation additionally carries `name: "AbortError"`, so a
 *  caller's existing fetch-style `error.name` check works unchanged. */
export interface AIError extends Error {
  code: AIErrorCode;
}

/** The runtime half of the closed set (the `INVOKE_ERROR_CODES` belt): a code
 *  from an older/other binary degrades to `INTERNAL` instead of lying about
 *  the union. A `Record` keyed by the union so widening one side without the
 *  other fails to compile. */
const AI_ERROR_CODES: Record<AIErrorCode, true> = {
  UNAVAILABLE: true,
  GUARDRAIL_VIOLATION: true,
  CONTEXT_WINDOW_EXCEEDED: true,
  UNSUPPORTED_LANGUAGE: true,
  DECODING_FAILURE: true,
  RATE_LIMITED: true,
  CONCURRENT_REQUESTS: true,
  REFUSAL: true,
  INVALID_SCHEMA: true,
  ABORTED: true,
  TIMEOUT: true,
  INTERNAL: true,
};

/** Index rather than `in`/`hasOwn` so an inherited key can't answer true. */
function isAIErrorCode(value: string): value is AIErrorCode {
  return AI_ERROR_CODES[value as AIErrorCode] === true;
}

function aiError(code: AIErrorCode, message: string): AIError {
  const error = new Error(message) as AIError;
  error.code = code;
  // The fetch shim's spelling, so one `error.name === "AbortError"` branch
  // serves both channels.
  if (code === "ABORTED") error.name = "AbortError";
  return error;
}

/**
 * The structural slice of `AbortSignal` this module needs — satisfied by the
 * runtime's fetch-installed shim (`WatchAbortSignal`), by DOM/Node signals in
 * tests, and by anything a caller hands in. Structural on purpose: `ai.ts`
 * must not import the fetch shim's class (the shim installs lazily and only
 * when the engine lacks fetch), and a nominal type would reject platform
 * signals that work fine.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** Options for {@link generateText}. */
export interface GenerateOptions {
  /** 0–1; higher = more creative. */
  temperature?: number;
  /** Cap on the response length (`GenerationOptions.maximumResponseTokens`). */
  maxTokens?: number;
  /** Optional system instructions for the session. */
  instructions?: string;
  /**
   * Streaming: called with the CUMULATIVE text so far as the model decodes
   * (Apple's `streamResponse` snapshots, not deltas — a snapshot is directly
   * renderable and a coalesced push self-heals, where a lost delta corrupts
   * everything after it). The promise still resolves with the complete text,
   * so streaming composes with the non-streaming call sites instead of
   * forking a second entry point.
   */
  onPartial?: (text: string) => void;
  /**
   * Coalescing floor for {@link onPartial}, ms. Not a decode rate: the model
   * decodes at its own pace, and this only bounds how often a snapshot may
   * CROSS the bridge — every push commits a render, so raise it as far as
   * your UI tolerates (the `metricsIntervalMs` idiom). Native default 250.
   */
  partialIntervalMs?: number;
  /**
   * Abort like fetch: generation stops natively (the model quits decoding —
   * on a watch the ~3B model is the most expensive thing to leave running)
   * and the promise rejects `ABORTED` with `name: "AbortError"`. Wire it to
   * an effect cleanup so a screen popping mid-generation cancels its own
   * request (ARCH-09 focus rules):
   *
   * ```ts
   * useEffect(() => {
   *   const ac = new AbortController();
   *   generateText("Summarize", { signal: ac.signal }).then(setText,
   *     (e) => { if (e.code !== "ABORTED") setError(e); });
   *   return () => ac.abort();
   * }, []);
   * ```
   */
  signal?: AbortSignalLike;
}

/** Options for {@link generateObject}: everything text generation takes minus
 *  the partial-stream knobs — a structured generation settles once (structured
 *  streaming is a recorded follow-up in the design note, not half-shipped). */
export type GenerateObjectOptions = Omit<
  GenerateOptions,
  "onPartial" | "partialIntervalMs"
>;

/**
 * A {@link generateObject} schema — a closed, typed SUBSET of JSON Schema.
 *
 * JSON Schema's field vocabulary on purpose (`type`/`properties`/`required`/
 * `items`/`enum`/`minItems`/`maxItems`/`description`): it is what every
 * surveyed structured-output API takes (Vercel AI SDK, OpenAI structured
 * outputs), so schemas emitted by existing tools subset straight in. Closed
 * on purpose too — full JSON Schema (`@types/json-schema`'s JSONSchema7)
 * admits keywords Apple's `DynamicGenerationSchema` cannot express (`$ref`,
 * `oneOf`, `patternProperties`, formats…), so typing this parameter as
 * JSONSchema7 would let schemas compile that the wire must reject at runtime.
 * The closed union makes an unsupported keyword a COMPILE error instead
 * (the SensorKind lesson). Everything here maps 1:1 onto a
 * `DynamicGenerationSchema` construct; what was cut and why is recorded in
 * the design note.
 */
export type AISchema =
  | {
      type: "string";
      description?: string;
      /** Constrains generation to these choices (`GenerationGuide.anyOf`). */
      enum?: readonly string[];
    }
  | { type: "number" | "integer"; description?: string }
  | { type: "boolean"; description?: string }
  | {
      type: "array";
      description?: string;
      items: AISchema;
      minItems?: number;
      maxItems?: number;
    }
  | AIObjectSchema;

/** The object node of {@link AISchema} — and the required ROOT of a
 *  {@link generateObject} call (every surveyed consumer pattern is
 *  object-rooted, and the root object is the model-visible type). */
export interface AIObjectSchema {
  type: "object";
  description?: string;
  /** Property order steers guided generation, and is preserved on the wire
   *  (insertion order of this object). */
  properties: Record<string, AISchema>;
  /** JSON Schema polarity: a property is OPTIONAL unless listed here. */
  required?: readonly string[];
}

/** The wire spelling of a schema node: `properties` becomes an ordered array
 *  of `{name, optional?, schema}` (Swift's dictionary decode would shuffle
 *  the order guided generation follows), and `required` folds into
 *  per-property `optional` flags (`DynamicGenerationSchema.Property
 *  .isOptional`'s polarity). Decoded by `AISchemaNode` in AIPlan.swift. */
interface WireSchemaNode {
  type: string;
  description?: string;
  enum?: readonly string[];
  items?: WireSchemaNode;
  minItems?: number;
  maxItems?: number;
  properties?: { name: string; optional?: boolean; schema: WireSchemaNode }[];
}

/** The loosely-typed view `schemaProblem` walks — a caller can hand in
 *  anything at runtime, so the validator trusts nothing the union promises. */
interface UncheckedSchema {
  type?: unknown;
  enum?: unknown;
  items?: AISchema;
  minItems?: unknown;
  maxItems?: unknown;
  properties?: Record<string, AISchema>;
  required?: unknown;
}

function enumProblem(node: UncheckedSchema, path: string): string | null {
  if (node.enum === undefined) return null;
  if (node.type !== "string") {
    return `${path}: enum is only supported on type "string"`;
  }
  const choices = node.enum;
  const wellFormed =
    Array.isArray(choices) &&
    choices.length > 0 &&
    choices.every((choice) => typeof choice === "string");
  return wellFormed ? null : `${path}: enum must be a non-empty string array`;
}

function arrayProblem(node: UncheckedSchema, path: string): string | null {
  if (!node.items) return `${path}: array requires items`;
  const { minItems, maxItems } = node;
  if (
    minItems !== undefined &&
    (typeof minItems !== "number" || minItems < 0)
  ) {
    return `${path}: minItems must be >= 0`;
  }
  if (
    maxItems !== undefined &&
    (typeof maxItems !== "number" || maxItems < 0)
  ) {
    return `${path}: maxItems must be >= 0`;
  }
  if (
    typeof minItems === "number" &&
    typeof maxItems === "number" &&
    minItems > maxItems
  ) {
    return `${path}: minItems > maxItems`;
  }
  return schemaProblem(node.items, `${path}[]`);
}

function objectProblem(node: UncheckedSchema, path: string): string | null {
  if (!node.properties || typeof node.properties !== "object") {
    return `${path}: object requires properties`;
  }
  const names = Object.keys(node.properties);
  if (node.required !== undefined) {
    if (!Array.isArray(node.required)) {
      return `${path}: required must be an array of property names`;
    }
    const unknown = node.required.find(
      (name) => !names.includes(name as string),
    );
    if (unknown !== undefined) {
      return `${path}: required names unknown property ${JSON.stringify(unknown)}`;
    }
  }
  for (const name of names) {
    if (name.length === 0) return `${path}: property name must not be empty`;
    const nested = schemaProblem(
      node.properties[name] as AISchema,
      `${path}.${name}`,
    );
    if (nested) return nested;
  }
  return null;
}

/**
 * Validates `schema` against the supported subset; returns the first problem
 * or null. Duplicated (deliberately) by `AISchemaNode.rootProblem()` on the
 * Swift side: this copy rejects before anything crosses the bridge — the
 * caller gets the error where the mistake is — and the native copy is the
 * backstop the wire actually enforces.
 */
function schemaProblem(schema: AISchema, path: string): string | null {
  const node = schema as UncheckedSchema;
  const type = node.type;
  if (
    type !== "object" &&
    type !== "array" &&
    type !== "string" &&
    type !== "number" &&
    type !== "integer" &&
    type !== "boolean"
  ) {
    return `${path}: unsupported type ${JSON.stringify(type)}`;
  }
  const badEnum = enumProblem(node, path);
  if (badEnum) return badEnum;
  if (type === "array") return arrayProblem(node, path);
  if (type === "object") return objectProblem(node, path);
  return null;
}

/** JSON Schema node → wire node (ordered properties, folded `required`). */
function toWireSchema(schema: AISchema): WireSchemaNode {
  const wire: WireSchemaNode = { type: schema.type };
  if (schema.description !== undefined) wire.description = schema.description;
  if (schema.type === "string" && schema.enum) wire.enum = schema.enum;
  if (schema.type === "array") {
    wire.items = toWireSchema(schema.items);
    if (schema.minItems !== undefined) wire.minItems = schema.minItems;
    if (schema.maxItems !== undefined) wire.maxItems = schema.maxItems;
  }
  if (schema.type === "object") {
    const required = schema.required ?? [];
    // Object.entries preserves the author's insertion order — the order
    // guided generation fills the fields in.
    wire.properties = Object.entries(schema.properties).map(
      ([name, child]) => ({
        name,
        ...(required.includes(name) ? {} : { optional: true }),
        schema: toWireSchema(child),
      }),
    );
  }
  return wire;
}

/** Cumulative streaming snapshots ride the native-event channel under this
 *  name, payload `{id, text}` — edge-triggered, so never replayed. */
export const AI_PARTIAL_EVENT = "ai.partial";

interface PendingGenerate {
  resolve: (text: string) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Re-arms the watchdog — called on every partial, so a long generation
   *  that is visibly decoding is never killed mid-stream. */
  resetTimer: () => void;
  /** Removes this request's `ai.partial` listener (streaming only). */
  offPartial?: () => void;
  signal?: AbortSignalLike;
  onAbort?: () => void;
}

const pending = new Map<number, PendingGenerate>();
let nextId = 1;

/**
 * Last-resort settle if native accepts a generate and never replies — a stuck
 * LanguageModelSession, an exception before the callback, a torn-down runtime.
 * An INACTIVITY bound, not a total one: every `ai.partial` re-arms it, so a
 * slow generation that is provably alive streams past 60s while a silent one
 * still can't leak its promise for the runtime's life (CX-022 "never hangs").
 */
const GENERATE_TIMEOUT_MS = 60_000;

/** The single settle path — removes the entry FIRST (settle exactly once) and
 *  tears down its timer/listeners. Returns the entry, or undefined if already
 *  settled (a late native reply after abort/timeout is a silent no-op). */
function takePending(id: number): PendingGenerate | undefined {
  const entry = pending.get(id);
  if (!entry) return undefined;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.offPartial?.();
  if (entry.signal && entry.onAbort) {
    entry.signal.removeEventListener("abort", entry.onAbort);
  }
  return entry;
}

const g = globalThis as Record<string, unknown>;
// Assigned UNCONDITIONALLY (most-recent evaluation wins) — the
// installInvokeBridge rule: an OTA re-eval gets a fresh `pending` map, and a
// guard keeping the OLD bundle's closures installed would hang every new call.
g.__resolveGenerate = (id: number, text: string) => {
  takePending(id)?.resolve(text);
};
g.__rejectGenerate = (id: number, errorJson: string) => {
  const entry = takePending(id);
  if (!entry) return;
  let code: AIErrorCode = "INTERNAL";
  let message = "native error";
  try {
    const parsed = JSON.parse(errorJson) as {
      code?: unknown;
      message?: unknown;
    };
    if (typeof parsed.message === "string") message = parsed.message;
    if (typeof parsed.code === "string") {
      if (isAIErrorCode(parsed.code)) {
        code = parsed.code;
      } else {
        // Unrecognized: the honest INTERNAL, original spelling kept in the
        // message so the native bug stays diagnosable (the invoke rule).
        message = `${parsed.code}: ${message}`;
      }
    }
  } catch {}
  entry.reject(aiError(code, message));
};

/**
 * Whether on-device AI can actually run on this watch right now (CX-002) —
 * a runtime check, distinct from whether the build exposes the `ai` capability.
 * It can be false even on watchOS 27+ (the model isn't downloaded, Apple
 * Intelligence is off, or the device isn't eligible). Use it to show/hide an AI
 * feature without making a throwaway `generateText` call. Resolves `false`
 * (never rejects) when there's no AI-capable host (tests/Node/widget) or the OS
 * is below watchOS 27.
 */
export async function isOnDeviceAIAvailable(): Promise<boolean> {
  try {
    return (await invoke<boolean>("aiAvailability")) === true;
  } catch {
    return false;
  }
}

/** The shared entry: arms the pending map, the inactivity watchdog, the
 *  partial listener and the abort wiring, then hands `request` to native.
 *  Resolves the RAW settle text ({@link generateObject} parses on top). */
function startGenerate(
  request: Record<string, unknown>,
  options: {
    signal?: AbortSignalLike | undefined;
    onPartial?: ((text: string) => void) | undefined;
  },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const host = getHost();
    if (!host?.generate) {
      reject(aiError("UNAVAILABLE", "on-device AI unavailable"));
      return;
    }
    const { signal, onPartial } = options;
    // An already-aborted signal never starts the model: reject before the
    // request crosses the bridge (the fetch contract).
    if (signal?.aborted) {
      reject(aiError("ABORTED", "generation aborted"));
      return;
    }
    const id = nextId++;
    const onTimeout = () => {
      if (!takePending(id)) return;
      // The model may still be decoding with nobody listening — stop it, the
      // same as an abort would (a silent 60s is either a stuck session or a
      // dead bridge; either way nothing useful can arrive).
      host.cancelGenerate?.(id);
      reject(
        aiError(
          "TIMEOUT",
          `generate got no native reply within ${GENERATE_TIMEOUT_MS}ms`,
        ),
      );
    };
    const entry: PendingGenerate = {
      resolve,
      reject,
      timer: setTimeout(onTimeout, GENERATE_TIMEOUT_MS),
      resetTimer: () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(onTimeout, GENERATE_TIMEOUT_MS);
      },
    };
    if (onPartial) {
      // One listener PER REQUEST, torn down on settle — the per-subscription
      // discipline the sensor streams use, with the id filter standing in
      // for the per-kind event name.
      entry.offPartial = registerNativeListener(AI_PARTIAL_EVENT, (payload) => {
        if (!payload || payload.id !== id) return;
        if (!pending.has(id)) return;
        entry.resetTimer();
        const text = payload.text;
        if (typeof text === "string") onPartial(text);
      });
    }
    if (signal) {
      entry.signal = signal;
      entry.onAbort = () => {
        if (!takePending(id)) return;
        // Settle FIRST, then stop the model: the screen that aborted is
        // usually unmounting, and its rejection handler must not race a
        // native settle for a generation that no longer matters.
        host.cancelGenerate?.(id);
        reject(aiError("ABORTED", "generation aborted"));
      };
      signal.addEventListener("abort", entry.onAbort);
    }
    pending.set(id, entry);
    host.generate(id, JSON.stringify(request));
  });
}

/** Builds the wire request fields shared by text + object generation. */
function baseRequest(
  prompt: string,
  options: GenerateObjectOptions | undefined,
): Record<string, unknown> {
  // Explicit fields, never an options spread: `signal`/`onPartial` are
  // runtime objects that must not be serialized into the wire.
  const request: Record<string, unknown> = { prompt };
  if (options?.instructions !== undefined) {
    request.instructions = options.instructions;
  }
  if (options?.temperature !== undefined) {
    request.temperature = options.temperature;
  }
  if (options?.maxTokens !== undefined) request.maxTokens = options.maxTokens;
  return request;
}

/**
 * Generates text with the on-device model. Rejects with an {@link AIError}
 * (`UNAVAILABLE` when AI can't run here). Pass {@link GenerateOptions.onPartial}
 * to stream cumulative partial text while the same promise still resolves the
 * complete answer, and {@link GenerateOptions.signal} to cancel:
 *
 * ```ts
 * const text = await generateText("Summarize my day", {
 *   instructions: "Be terse.",
 *   onPartial: (soFar) => setPreview(soFar),
 *   signal: controller.signal,
 * });
 * ```
 */
export function generateText(
  prompt: string,
  options?: GenerateOptions,
): Promise<string> {
  const request = baseRequest(prompt, options);
  if (options?.onPartial) {
    request.stream = true;
    if (options.partialIntervalMs !== undefined) {
      request.partialIntervalMs = options.partialIntervalMs;
    }
  }
  return startGenerate(request, {
    signal: options?.signal,
    onPartial: options?.onPartial,
  });
}

/**
 * Guided generation: the on-device model fills in `schema` (a typed JSON
 * Schema subset, {@link AISchema}) and the promise resolves the parsed object.
 * Constrained decoding natively (`DynamicGenerationSchema`), so the model
 * cannot produce keys or types outside the schema; a generation that still
 * can't be decoded — or that the model refuses — rejects with a typed
 * {@link AIError} (`DECODING_FAILURE`, `REFUSAL`, …), never garbage.
 *
 * `T` is a compile-time assertion like `invoke<T>` — the schema is the
 * runtime contract; keep the two in agreement.
 *
 * ```ts
 * const plan = await generateObject<{ title: string; minutes: number }>(
 *   "Suggest one 10-minute mobility exercise",
 *   {
 *     type: "object",
 *     properties: {
 *       title: { type: "string" },
 *       minutes: { type: "integer" },
 *     },
 *     required: ["title", "minutes"],
 *   },
 * );
 * ```
 */
export function generateObject<T = unknown>(
  prompt: string,
  schema: AIObjectSchema,
  options?: GenerateObjectOptions,
): Promise<T> {
  if (schema.type !== "object") {
    return Promise.reject(
      aiError(
        "INVALID_SCHEMA",
        `schema root must be type "object", got ${JSON.stringify(
          (schema as { type?: unknown }).type,
        )}`,
      ),
    );
  }
  const problem = schemaProblem(schema, "schema");
  if (problem) {
    return Promise.reject(aiError("INVALID_SCHEMA", problem));
  }
  const request = baseRequest(prompt, options);
  request.schema = toWireSchema(schema);
  return startGenerate(request, { signal: options?.signal }).then((json) => {
    try {
      return JSON.parse(json) as T;
    } catch {
      // Native resolves GeneratedContent.jsonString, which is JSON by
      // construction — reaching here means a native bug or a host that
      // resolved free text. Typed, so a caller can still switch on it.
      throw aiError(
        "DECODING_FAILURE",
        "generateObject result is not valid JSON",
      );
    }
  });
}
