# Design — on-device AI: streaming tokens + structured output

Shipped 2026-08-22 (roadmap §6, the first two natural extensions of
`generateText`). This records the decisions and their reasons so the *why*
survives the diff, and states plainly what a Linux `swift test` can and cannot
prove about a feature whose native half only compiles against the watchOS 27
SDK.

Scope: **streaming partial results** through the existing `__pushNativeEvent`
channel, **cancellation** that actually stops the model, and
**`generateObject(prompt, schema)`** guided generation. Of the other two §6
extensions, **tool calling shipped the same day** — its design record is the
dated section at the end of this file — and App Shortcuts stays untouched.

## Availability (Apple docs JSON, fetched 2026-08-22)

Everything this feature uses is **watchOS 27.0 (beta)** — the CX-002 floor
holds; nothing here moves the gate:

| Symbol | watchOS `introducedAt` |
|---|---|
| FoundationModels (framework page) | **27.0 beta** (iOS 26.0) |
| `LanguageModelSession` | 27.0 beta |
| `LanguageModelSession.respond(to:options:)` | 27.0 beta |
| `LanguageModelSession.streamResponse(to:options:)` | 27.0 beta |
| `LanguageModelSession.ResponseStream` (+ `.Snapshot`, `collect()`) | 27.0 beta |
| `LanguageModelSession.respond(to:schema:includeSchemaInPrompt:options:)` | 27.0 beta |
| `LanguageModelSession.isResponding` | 27.0 beta |
| `GenerationOptions` (+ `temperature`, `maximumResponseTokens`) | 27.0 beta |
| `GenerationSchema` (+ `init(root:dependencies:)` — throws) | 27.0 beta |
| `DynamicGenerationSchema` (+ `init(name:description:properties:)`, `init(name:description:anyOf:)`, `init(arrayOf:minimumElements:maximumElements:)`, `init(type:guides:)`, `.Property.init(name:description:schema:isOptional:)`) | 27.0 beta |
| `GenerationGuide` (+ `.anyOf(_: [String])`) | 27.0 beta |
| `GeneratedContent` (+ `init(json:)`, `jsonString`) | 27.0 beta |
| `Prompt.init(_:)` | 27.0 beta |

**Metadata gaps, recorded rather than acted on:** the per-page JSON for
`SystemLanguageModel` (+ `isAvailable`, `Availability`),
`LanguageModelSession.GenerationError`, and
`LanguageModelSession.init(model:tools:instructions:)` lists iOS 26.0 but *no
watchOS row at all* — while the framework page says watchOS 27.0 beta and the
session's `respond`/`streamResponse` pages carry it. A session cannot exist
without `SystemLanguageModel` (the init's `model:` default is `.default`), so
these read as doc-metadata lag, not availability facts. Re-checking the gate
against a symbol with *missing* metadata would be the CX-002 failure mode in
reverse (gating on absence); the gate stays `#available(watchOS 27.0, *)` and
the Xcode-27 compile is the arbiter (owed below).

`GenerationError` cases swept for the error vocabulary: `assetsUnavailable`,
`guardrailViolation`, `exceededContextWindowSize`,
`unsupportedLanguageOrLocale`, `decodingFailure`, `rateLimited`,
`concurrentRequests`, `refusal`, `unsupportedGuide` (plus `Refusal`/`Context`
carriers).

## Prior art (rule 3 — surveyed before designing)

- **Vercel AI SDK** — the reference JS shape: `streamText()` returning
  `{textStream, text}` (delta streams), `generateObject({schema})` taking
  Zod/JSON Schema and throwing `NoObjectGeneratedError` on a malformed
  generation, `abortSignal` on every call.
- **Apple `LanguageModelSession.streamResponse`** — an AsyncSequence of
  **cumulative snapshots** ("snapshots of partially generated content"), not
  deltas; `collect()` folds the stream into the final Response.
- **OpenAI structured outputs** — JSON Schema (strict subset) as the industry
  schema vocabulary.

Verdicts, each with its reason:

- **Compose, don't fork** (differs from Vercel's separate `streamText`):
  streaming is `generateText(prompt, {onPartial})` — the promise still
  resolves the full text. A watch app's streaming consumer is a screen
  repainting one `Text`; a second entry point returning an async iterable
  would add API surface QuickJS consumers pay for on every bundle, for no
  added capability. The repo's own stream shape (`startSensor(handler)`,
  `startHealthUpdates(handler)`) is callback-based for the same reason.
- **Cumulative snapshots, not deltas** (Apple's shape, against Vercel's):
  a snapshot is directly renderable, a coalesced/dropped push is superseded by
  the next one by construction, and native delta-slicing could split grapheme
  clusters. The wire forwards what the OS produces.
- **JSON Schema subset, typed closed** (with OpenAI/Vercel, against a
  hand-rolled vocabulary): `type`/`properties`/`required`/`items`/`enum`/
  `minItems`/`maxItems`/`description` — every construct maps 1:1 onto a
  `DynamicGenerationSchema` initializer (see the availability table). Not
  `@types/json-schema`'s `JSONSchema7`, although it exists and rule 3 prefers
  published types: full JSON Schema admits keywords Apple's runtime schema
  cannot express (`$ref`, `oneOf`, `patternProperties`, formats…), so the
  published type would *type-check schemas the wire must reject* — the closed
  union (`AISchema`) makes an unsupported keyword a compile error instead
  (the SensorKind lesson). Not Zod: a runtime validation library in the
  QuickJS bundle for schemas we forward, not enforce, is pure size.
- **Cancellation via `AbortSignal`** (the web idiom, already installed by the
  fetch shim): `GenerateOptions.signal` + a `cancelGenerate(id)` host method —
  the `abortFetch` pattern verbatim. `ai.ts` takes a *structural*
  `AbortSignalLike` so it never imports the lazily-installed shim class.

## The wire

- `__host.generate(id, requestJson)` — request decodes as
  `GeneratePlan` (ReactWatchSupport, Linux-tested):
  `{prompt, instructions?, temperature?, maxTokens?, stream?,
  partialIntervalMs?, schema?}`.
- Streaming: native pushes `ai.partial` `{id, text}` (cumulative) through
  `__pushNativeEvent`; edge-triggered, so never in `REPLAYED_EVENTS`.
- Settle: `__resolveGenerate(id, text)` (for `generateObject`, `text` is
  `GeneratedContent.jsonString`); `__rejectGenerate(id, errorJson)` where
  errorJson is `{code, message}` over the closed `AIErrorCode` vocabulary —
  the invoke channel's typed-reject discipline. A bare message string (the
  previous wire) left JS nothing to switch on; pre-release, changed in place.
- `__host.cancelGenerate(id)` — no reply; JS settles synchronously on abort.
- Schema wire: JSON Schema's `properties` **object** becomes an **ordered
  array** of `{name, optional?, schema}` and `required` folds into
  per-property `optional` flags. Property order steers guided generation
  (`DynamicGenerationSchema` takes `[Property]`), and a Swift
  `[String: …]` decode would shuffle it; `Object.entries` preserves the
  author's order, so JS converts at the edge. Cross-language fixtures
  (`Fixtures/generate-text-request.json`, `generate-object-request.json`) are
  written from the real wrapper's traffic and decoded by `AIPlanTests` — the
  invoke-contract idiom applied to the one direct method with a structured
  request.

## Error vocabulary

`AIErrorCode` (TS union + Swift enum, both closed, pinned against the
FoundationModels case names by a Linux test):

| FM `GenerationError` case | wire code |
|---|---|
| `assetsUnavailable` | `UNAVAILABLE` |
| `guardrailViolation` | `GUARDRAIL_VIOLATION` |
| `exceededContextWindowSize` | `CONTEXT_WINDOW_EXCEEDED` |
| `unsupportedLanguageOrLocale` | `UNSUPPORTED_LANGUAGE` |
| `decodingFailure` | `DECODING_FAILURE` |
| `rateLimited` | `RATE_LIMITED` |
| `concurrentRequests` | `CONCURRENT_REQUESTS` |
| `refusal` | `REFUSAL` |
| `unsupportedGuide` | `INVALID_SCHEMA` |
| *(unknown / future case)* | `INTERNAL` |

`ABORTED` (with `name: "AbortError"`, the fetch spelling) and `TIMEOUT` are
minted JS-side; `INVALID_SCHEMA` is also produced by both validators before
FoundationModels is ever reached. An unrecognized native code degrades to
`INTERNAL` with the original spelling kept in the message (the invoke rule).
The SDK-gated host switch only transcribes FM cases to their *names*; the
name→code table lives in ReactWatchSupport where Linux tests pin it.

"Malformed rejects typed, not garbage": a structured resolve that fails
`JSON.parse` rejects `DECODING_FAILURE`; a schema outside the subset rejects
`INVALID_SCHEMA` from the JS walk (at the call site, synchronously) *and*
from the identical native walk (the backstop a raw `__host` caller hits).

## Lifecycle discipline (mirrored from the sensor streams)

- **Epoch/teardown** — "a stream must not outlive the runtime that asked for
  it": `tearDownGeneration()` cancels every in-flight generate `Task`
  alongside the fetch tasks. Cancelling stops the *decode* (and with it the
  name-routed, generation-unguarded `ai.partial` pushes); every task
  completion is generation-guarded (CX-008 — ids reset per runtime).
- **Cancellation** (ARCH-09: a popped screen's generation is pure battery
  burn): abort settles the JS promise first, then `cancelGenerate(id)` stops
  the model. The JS watchdog does the same — a silent 60 s means the model may
  be decoding for nobody.
- **Inactivity watchdog, not a total bound**: every partial re-arms the 60 s
  timer, so a slow generation that is provably decoding streams past 60 s
  while a silent one still can't leak its promise (CX-022 "never hangs").
- **Coalescing floor** — `partialIntervalMs` (native default 250 ms), the
  `metricsIntervalMs`/`minIntervalMs` idiom: every push commits a render, so
  the floor bounds bridge crossings, never the decode. Dropped intermediates
  are superseded by the next snapshot; the final text rides the resolve.
- **Foreground/background** — deliberately *no* keep-alive and no
  background cancel: a generate task does not pin the app (unlike a workout
  session), so backgrounding suspends it with the process and it resumes with
  the foreground. The heart-rate pump's pause/restore machinery exists
  because HealthKit keeps the app alive; nothing here does.

## Smaller decisions worth their line

- **Object-rooted schemas only.** Every surveyed consumer pattern is
  object-rooted, and `DynamicGenerationSchema`'s object initializer wants a
  name — the root is the model-visible "Output" type. A non-object root
  rejects `INVALID_SCHEMA` rather than growing three more root modes nobody
  asked for.
- **`required` is JSON Schema's polarity** (optional-unless-listed), folded
  into `Property.isOptional` at the JS→wire edge so neither side re-derives
  it.
- **Streaming suppressed for `generateObject`** (`wantsStream` requires
  `schema == nil`): Apple *can* stream structured snapshots
  (`streamResponse(to:schema:…)`, verified 27.0 beta), but partially-formed
  objects need a `PartiallyGenerated`-shaped JS contract of their own.
  Recorded follow-up, not smuggled in.
- **Nested type names derive from property names** (root "Output", property
  `name`, array items `name + "Item"`). Two sibling objects deriving the same
  type name make `GenerationSchema.init` throw → surfaces as a typed
  rejection; acceptable until a real consumer hits it (then: disambiguate
  with a path prefix).
- **Numeric `minimum`/`maximum` guides cut from v1**: the docs list the
  bound statics as `Decimal`-flavored and the exact overload surface can't be
  compile-checked without the Xcode 27 SDK; constraining numbers is additive
  later (`GenerationGuide.range/minimum/maximum` all 27.0 beta).
- **`includeSchemaInPrompt` not exposed**: a prompt-engineering knob with a
  sane default; surface it when a consumer demonstrates the need.
- **`prewarm()` not called**: it trades memory for latency on a device where
  memory is the scarcer budget; a complication-adjacent app should decide
  that, not the bridge.

## Verification status, stated plainly

**Proven here (Linux `swift test` 429 / vitest 817, both green):**
`GeneratePlan` decode incl. real-traffic fixtures, the schema subset's full
validation matrix on both sides, the error-name→code table, error-JSON
escaping, the `cancelGenerate` trampoline + install/policy/widget-omission
tables, and the whole JS contract — streaming delivery/filtering/teardown,
watchdog re-arm, abort (incl. pre-aborted signals and settle-once races),
ordered-wire conversion, typed rejections, `generateObject` parse + failure
paths.

**Owed to a Mac (compile) / a watchOS 27 device (behavior) — the FM block
compiles out below the watchOS 27 SDK, so none of this has ever compiled:**

1. Xcode 27 compile of the `#if canImport(FoundationModels)` block —
   including the exact `ResponseStream` element shape (written as
   `snapshot.content`), `LanguageModelSession(instructions: String)` (the
   docs now show an `InstructionsBuilder` init; a spelling fix may be needed),
   and `Prompt(plan.prompt)`.
2. `dynamicSchema(from:)` against the real `DynamicGenerationSchema` —
   initializer labels, `Property` argument order, `GenerationSchema` throw
   behavior on duplicate names.
3. Device: real streaming cadence (does the 250 ms floor hold against FM's
   snapshot rate), cancellation latency, guardrail/refusal error shapes,
   `isOnDeviceAIAvailable()` against a real model download state, and the
   generation-vs-teardown race on a live reload.
4. The two watch-sim gates from CONTRIBUTING (package build for the watch
   SDK; `pnpm test:swift:watch`) — untouched by this change but they now
   compile the new host code (`generateTasks`, `cancelGenerate`, the plan
   rewrite) even on a pre-27 SDK, since only the FM block is `canImport`-gated.

## Deliberately not built (each a named follow-up)

- **Tool calling** (§6 extension 3) — ~~FM `Tool` conformances invoking host
  methods; needs its own capability/consent design~~ **shipped the same day;
  see the dated section below.**
- **App Shortcuts / Siri** (§6 extension 4).
- **Structured streaming** (`streamResponse(to:schema:)`) — see above.
- **Session reuse / multi-turn transcripts** — every call builds a fresh
  `LanguageModelSession`; a conversation API wants transcript lifecycle +
  context-window management, and `CONTEXT_WINDOW_EXCEEDED` is already typed
  for it.
- **Numeric generation guides**, **`includeSchemaInPrompt`**, **`prewarm`** —
  see the decisions above.

---

# Tool calling (§6 extension 3 — added 2026-08-22, same day)

`generateText(prompt, {tools})` lets the on-device model invoke JS-defined
tools mid-generation: the model pauses, the app's async JS handler runs (it
can read stores, call host APIs, fetch), and the model resumes with the
result. The demo grounds "How is my hydration going?" in the live App-Group
counter this way.

## Availability (Apple docs JSON, fetched 2026-08-22)

Everything new is **watchOS 27.0 (beta)** via the framework page — the gate
stays `#available(watchOS 27.0, *)`:

| Symbol | watchOS `introducedAt` |
|---|---|
| `Tool` (`protocol Tool<Arguments, Output> : Sendable`) | 27.0 beta |
| `Tool.call(arguments:)` — `@concurrent … async throws -> Self.Output` | 27.0 beta |
| `Tool.Arguments : ConvertibleFromGeneratedContent` | 27.0 beta |
| `Tool.Output : PromptRepresentable` | 27.0 beta |
| `Tool.name` / `.description` / `.parameters: GenerationSchema` | 27.0 beta |
| `GeneratedContent` (conforms to BOTH associated-type constraints) | 27.0 beta |
| `PromptRepresentable` (conforming types list includes `GeneratedContent`) | 27.0 beta |
| `LanguageModelSession.init(model:tools:instructions:)` | *no watchOS row* (iOS 26.0) — the same metadata lag recorded above for the plain init |
| `LanguageModelSession.ToolCallError` (+ `.tool`, `.underlyingError`) | *no watchOS row* (iOS 26.0) — same lag class |

Two load-bearing facts from the `Tool` docs' discussion text, not just the
signatures: the framework itself runs the model→tool→model loop ("after
calling your tool, the framework returns the tool's output back to the model")
— there is **no external submit-tool-outputs API and none is needed**; and a
tool body's thrown errors are "wrapped in a ToolCallError and rethrown at the
call site of respond()", which is where the host's typed reject comes from.
Tool definitions are placed in the prompt and **spend context window** — the
JSDoc warns accordingly.

## Prior art (rule 3 — surveyed before designing)

- **Apple FM `Tool`** — tools attach at session init; `call` is `async` and
  `@concurrent` (the framework may run tools concurrently and back-to-back);
  arguments arrive constrained-decoded against `parameters`.
- **Vercel AI SDK** — `tools: {name: {description, parameters/inputSchema,
  execute: async (args, {toolCallId, abortSignal}) => value}}`: a name-keyed
  record, Zod args, an execute handler with a call context.
- **OpenAI function calling** — `{name, description, parameters: JSONSchema}`,
  but an EXPLICIT resume protocol: the API returns `tool_calls` and the caller
  loops, appending role:"tool" messages.

Verdicts:

- **`tools` as a name-keyed record** (Vercel): duplicate names are impossible
  at the call site by construction (an array could declare two), and the key
  doubles as the name. The wire folds it to an ordered array — the
  properties-wire idiom, since declaration order is prompt order and a Swift
  dictionary decode would shuffle it; the native walk still rejects duplicates
  for raw `__host` callers.
- **`parameters` + `execute`** (the words Apple, OpenAI and Vercel v4 share;
  `execute` over `call` because the Vercel shape is what JS consumers know).
  `execute(args, {toolCallId, signal})` mirrors Vercel's call context.
- **Argument schema = the existing `AISchema` subset**, not a second
  vocabulary: it already maps 1:1 onto `DynamicGenerationSchema`, which is
  exactly what `Tool.parameters` wants (`GenerationSchema`), so tools and
  `generateObject` share one closed schema language, one validator per side,
  and one wire spelling.
- **No JS-visible tool loop** (against OpenAI's shape): Apple's framework runs
  the loop natively, so surfacing intermediate tool-call turns would invent
  protocol the platform doesn't have. The JS API is: declare tools, await the
  final text.
- **Args typed `Record<string, unknown>`**, not schema-inferred generics: the
  `invoke<T>`/`generateObject<T>` compact — the schema is the runtime
  contract; a type-level AISchema→TS inference engine is real surface for a
  watch bundle's worth of zero runtime value.

## The round trip, and why it cannot deadlock

The model runs inside Swift; the tools are JS functions. A call must round-trip
**model → Swift pauses → JS runs the handler → Swift resumes the model** — the
shape the DAP design note proved dangerous when done as *waiting*, because the
JS runtime's owning queue is main: anything that BLOCKS a thread waiting for a
hop onto the queue it occupies freezes forever.

The design has no blocking anywhere — every wait is a structured suspension:

1. FM wants the tool → it awaits `call(arguments:)` (`@concurrent`, off-main).
   The bridged tool awaits a `CheckedContinuation` — the FM task **parks**, its
   thread is released.
2. Registration hops to the main actor (a `Task { @MainActor … }` — `call`
   runs off-main while all tool state is main-isolated), mints a `callId`,
   stores the continuation, and pushes `ai.toolCall`
   `{id, callId, tool, argumentsJson}` through the normal event channel.
3. JS (on main) dispatches to the per-request listener; the handler runs
   **async** — the JS thread never spins; main stays free.
4. The handler settles → JS calls `__host.toolResult(id, callId, replyJson)` —
   a synchronous C hop on the JS queue — which resumes the parked
   continuation. The FM task picks up off-main; the model resumes.

The rejected alternative — a synchronous host hook Swift blocks a semaphore on
while JS computes (the `__debugPoll` shape) — would deadlock here: the generate
task inherits the main actor (`Task {}` in a `@MainActor` method), and even
off-main it would pin one of FM's threads for the whole tool run. `__debugPoll`
gets away with blocking because blocking main **is** what a breakpoint means;
a tool call is the opposite.

So JS-implemented tools are fully possible without blocking — no honest-subset
fallback needed. What Linux cannot prove is only the FM half (owed below).

## The wire

- `GeneratePlan.tools?: [{name, description?, schema}]` (`AIToolSpec`,
  Linux-decoded; `toolsProblem()` is the native validation walk — empty name,
  duplicates, non-object root, subset breaches with `tools.<name>` paths, and
  the tools+schema combination refused: guided generation with tool calls is a
  recorded follow-up, not half-shipped).
- Push: `ai.toolCall` `{id, callId, tool, argumentsJson}` — edge-triggered,
  never in `REPLAYED_EVENTS` (replaying one would run a tool the model never
  asked for). `argumentsJson` is `GeneratedContent.jsonString` verbatim.
- Reply: `__host.toolResult(id, callId, replyJson)` — a DIRECT host method
  (feature `ai`, the first `(int, int, string)` trampoline), not via invoke:
  JS never awaits a response, so the fire-and-forget shape of
  `cancelGenerate`/`abortFetch` is the whole contract — the "response" is the
  generation resuming. `replyJson` is `{"result": <any JSON>}` or
  `{"error": "<message>"}`, parsed by `AIToolReply` (Linux-tested; fragments
  allowed — a tool may return a bare scalar; JS normalizes an `undefined`
  return to `null` so the key is always present).
- `callId` is **Swift-minted and process-monotonic** — unlike request ids,
  which JS mints and resets per runtime (CX-008) — so a stale reply from a
  torn-down runtime can never alias onto a fresh continuation.
- Cross-language fixture: `Fixtures/generate-tools-request.json`, written from
  the real wrapper's traffic (a described enum-arg tool + a bare no-arg tool)
  and decoded by `AIPlanTests`.

## Error vocabulary: one genuinely new class

`TOOL_FAILED` (TS union + Swift `AIErrorCode.toolFailed`): a tool the model
invoked failed — the JS handler threw/rejected, replied malformed, or named an
undeclared tool (a bridge bug JS still answers, so the native continuation is
never left parked). It is genuinely new: natively it arrives as
`LanguageModelSession.ToolCallError`, a **wrapper struct, not a
`GenerationError` case**, so it has no row in `forGenerationError` (a
dedicated Linux test pins the spelling instead) — and no existing code
honestly covers "your own tool broke" (Vercel's distinct `ToolExecutionError`
is the same judgment). Schema problems in a tool's `parameters` are NOT new:
they reject `INVALID_SCHEMA` with a `tools.<name>` path, from both validators.
A cancelled round trip surfaces natively as ToolCallError-wrapping-
CancellationError and stays silent — JS already settled.

## Lifecycle (the sensor-stream rules, applied to parked calls)

- **Cancellation**: `cancelGenerate(id)` now fails that request's parked
  continuations (CancellationError) FIRST, then cancels the task — a
  cancelled task alone would leave FM suspended in `call` awaiting a reply
  that will never come. `tearDownGeneration()` does the same for all.
  Registration re-checks liveness on the main actor, so a call racing the
  cancel fails immediately instead of parking unresumable.
- **JS half of cancellation**: every settle (abort, timeout, reject, resolve)
  aborts a per-request `AIToolCallContext.signal`, so a handler's own async
  work sees the cancellation; a handler that settles after the generation did
  finds `pending` empty and its reply goes nowhere (native tolerates the
  unknown callId). The signal is a ~20-line hand-rolled `AbortSignalLike` —
  not the fetch shim's `AbortController`, which installs lazily and is
  deliberately unimportable here (the structural-signal rule above).
- **Watchdog composition**: a tool call and its reply both re-arm the 60 s
  inactivity watchdog (the model is provably alive — it just asked for
  something). The bound applies to the HANDLER too: a tool silent past the
  watchdog is treated as stuck, the generation times out and is cancelled,
  tool included. No second timer.
- **Streaming composes** (`onPartial` + `tools`): snapshots simply pause while
  a tool runs. `generateObject` does NOT take tools (type-level omit, native
  refusal) — Apple can combine them, but structured-output-with-tools is a
  follow-up with its own semantics, the structured-streaming posture.

## Verification status

**Proven on Linux** (vitest 847 / `swift test` 444, both green): the tools
wire + ordered fold, spec decode + both validation walks, `AIToolReply`
parsing incl. fragments and malformed shapes, the `toolResult` trampoline
marshaling, install/policy/widget-omission tables, and the whole JS contract —
execute invocation with args + context, result/error/undefined threading,
unknown-tool + malformed-args backstops, settle-drops-late-replies, abort
propagation into the tool signal, watchdog re-arming, TOOL_FAILED typing,
INVALID_SCHEMA at the call site.

**Owed to Xcode 27 / a device** (the FM block still has never compiled), on
top of the streaming section's list:

1. `LanguageModelSession(tools:instructions:)` — the docs now list only the
   `@InstructionsBuilder` init and give the tools init no watchOS row; the
   code keeps the sample-code spelling (`tools:` + string instructions), same
   risk class as the recorded `instructions:` note above.
2. `JSBridgedTool`: that a `GeneratedContent`-for-both-associated-types
   conformance satisfies `Tool` as written, incl. the `@concurrent` witness.
3. `ToolCallError.underlyingError` unwrap semantics (does our
   `AIToolFailure` survive FM's wrapping intact?) and whether FM cancels
   in-flight tool calls itself on task cancellation (our explicit
   continuation-failing makes this moot, but the double-resume guard —
   remove-then-resume — is what a device test should exercise).
4. Device behavior: how the ~3B model actually uses a declared tool (call
   frequency, argument quality), the context-window cost of tool definitions,
   and concurrency (parallel `call`s parking multiple continuations).
