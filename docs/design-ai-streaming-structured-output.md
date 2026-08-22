# Design — on-device AI: streaming tokens + structured output

Shipped 2026-08-22 (roadmap §6, the first two natural extensions of
`generateText`). This records the decisions and their reasons so the *why*
survives the diff, and states plainly what a Linux `swift test` can and cannot
prove about a feature whose native half only compiles against the watchOS 27
SDK.

Scope: **streaming partial results** through the existing `__pushNativeEvent`
channel, **cancellation** that actually stops the model, and
**`generateObject(prompt, schema)`** guided generation. The other two §6
extensions — tool calling and App Shortcuts — are deliberately untouched.

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

- **Tool calling** (§6 extension 3) — FM `Tool` conformances invoking host
  methods; needs its own capability/consent design.
- **App Shortcuts / Siri** (§6 extension 4).
- **Structured streaming** (`streamResponse(to:schema:)`) — see above.
- **Session reuse / multi-turn transcripts** — every call builds a fresh
  `LanguageModelSession`; a conversation API wants transcript lifecycle +
  context-window management, and `CONTEXT_WINDOW_EXCEEDED` is already typed
  for it.
- **Numeric generation guides**, **`includeSchemaInPrompt`**, **`prewarm`** —
  see the decisions above.
