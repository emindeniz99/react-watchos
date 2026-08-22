import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIError, AIObjectSchema } from "../src/index";
import {
  AI_PARTIAL_EVENT,
  generateObject,
  generateText,
  isOnDeviceAIAvailable,
} from "../src/index";
import { dispatchNativeEvent } from "../src/nativeEvents";
import { installMockHost } from "./helpers";

const g = globalThis as Record<string, unknown>;

/** The generate channel's cross-language fixtures (the invoke-contract idiom
 *  applied to the one DIRECT method with a structured request): the JSON the
 *  real wrapper produced is committed for `AIPlanTests.swift` to decode with
 *  the shipped `GeneratePlan`, so a renamed request field fails `swift test`
 *  instead of surfacing as a silently-ignored option on a watch. */
const fixturesDir = join(__dirname, "../swift/Tests/ReactWatchTests/Fixtures");
function writeGenerateFixture(name: string, json: string): void {
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(
    join(fixturesDir, `${name}.json`),
    `${JSON.stringify(JSON.parse(json), null, 2)}\n`,
  );
}

const resolveGenerate = (id: number, text: string) =>
  (g.__resolveGenerate as (i: number, t: string) => void)(id, text);
const rejectGenerate = (id: number, errorJson: string) =>
  (g.__rejectGenerate as (i: number, e: string) => void)(id, errorJson);

afterEach(() => {
  delete g.__host;
});

describe("on-device AI (generateText)", () => {
  it("sends the prompt + options and resolves with generated text", async () => {
    const host = installMockHost();
    const promise = generateText("Summarize my day", {
      temperature: 0.7,
      maxTokens: 128,
      instructions: "Be terse.",
    });
    expect(host.generate).toHaveBeenCalledTimes(1);
    const [id, reqJson] = host.generate.mock.calls[0];
    // maxTokens must reach the request JSON so the native side can cap the
    // response (GenerationOptions.maximumResponseTokens) — CX-002.
    expect(JSON.parse(reqJson)).toEqual({
      prompt: "Summarize my day",
      temperature: 0.7,
      maxTokens: 128,
      instructions: "Be terse.",
    });

    resolveGenerate(id, "Busy but good.");
    expect(await promise).toBe("Busy but good.");
  });

  it("rejects with the typed {code, message} the native side sends", async () => {
    const host = installMockHost();
    const promise = generateText("hi");
    const [id] = host.generate.mock.calls[0];
    rejectGenerate(
      id,
      JSON.stringify({ code: "GUARDRAIL_VIOLATION", message: "flagged" }),
    );
    const error: AIError = await promise.then(
      () => {
        throw new Error("resolved");
      },
      (e) => e,
    );
    expect(error.code).toBe("GUARDRAIL_VIOLATION");
    expect(error.message).toBe("flagged");
  });

  it("degrades an unrecognized native code to INTERNAL, spelling kept", async () => {
    // The invoke-channel belt on this channel: a code from an older/other
    // binary must not land in `error.code` as a value the union endorses.
    const host = installMockHost();
    const promise = generateText("hi");
    const [id] = host.generate.mock.calls[0];
    rejectGenerate(
      id,
      JSON.stringify({ code: "MODEL_ON_FIRE", message: "boom" }),
    );
    const error: AIError = await promise.catch((e) => e);
    expect(error.code).toBe("INTERNAL");
    expect(error.message).toBe("MODEL_ON_FIRE: boom");
  });

  it("rejects UNAVAILABLE when on-device AI is unavailable", async () => {
    const error: AIError = await generateText("hi").catch((e) => e);
    expect(error.code).toBe("UNAVAILABLE");
    expect(error.message).toMatch(/unavailable/);
  });

  it("rejects (never hangs) if native accepts but never replies (CX-022)", async () => {
    vi.useFakeTimers();
    try {
      // generate mock records the call but never settles
      const host = installMockHost();
      const expectation = expect(generateText("hi")).rejects.toMatchObject({
        code: "TIMEOUT",
        message: expect.stringMatching(/no native reply/),
      });
      await vi.advanceTimersByTimeAsync(60_000);
      await expectation;
      // A silent 60s means the model may still be decoding for nobody —
      // the watchdog stops it like an abort would.
      const [id] = host.generate.mock.calls[0];
      expect(host.cancelGenerate).toHaveBeenCalledWith(id);
    } finally {
      vi.useRealTimers();
    }
  });

  // CX-002 capability query: a runtime availability check (distinct from the
  // build-time `ai` feature) so UIs can show/hide AI without a throwaway call.
  it("isOnDeviceAIAvailable resolves false without an AI-capable host", async () => {
    expect(await isOnDeviceAIAvailable()).toBe(false);
  });

  it("isOnDeviceAIAvailable resolves the host's answer", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number, method: string) => {
      const g = globalThis as {
        __resolveInvoke?: (id: number, resultJson: string) => void;
      };
      if (method === "aiAvailability") g.__resolveInvoke?.(id, "true");
    });
    expect(await isOnDeviceAIAvailable()).toBe(true);
  });
});

describe("streaming (onPartial)", () => {
  it("marks the request streaming and delivers cumulative partials", async () => {
    const host = installMockHost();
    const partials: string[] = [];
    const promise = generateText("Tell me a story", {
      instructions: "One sentence at a time.",
      temperature: 0.5,
      maxTokens: 256,
      partialIntervalMs: 100,
      onPartial: (text) => partials.push(text),
    });
    const [id, reqJson] = host.generate.mock.calls[0];
    expect(JSON.parse(reqJson)).toMatchObject({
      prompt: "Tell me a story",
      stream: true,
      partialIntervalMs: 100,
    });
    // The REAL streaming request is the committed Swift decode fixture.
    writeGenerateFixture("generate-text-request", reqJson);

    // Apple's ResponseStream snapshots are CUMULATIVE — each partial is the
    // whole text so far, so the last one is a prefix of the resolve.
    dispatchNativeEvent(AI_PARTIAL_EVENT, { id, text: "Once" });
    dispatchNativeEvent(AI_PARTIAL_EVENT, { id, text: "Once upon" });
    // Another request's partial must not leak into this one.
    dispatchNativeEvent(AI_PARTIAL_EVENT, { id: id + 999, text: "other" });
    expect(partials).toEqual(["Once", "Once upon"]);

    resolveGenerate(id, "Once upon a time.");
    expect(await promise).toBe("Once upon a time.");

    // The stream is torn down with the settle: a late push reaches nobody.
    dispatchNativeEvent(AI_PARTIAL_EVENT, { id, text: "late" });
    expect(partials).toEqual(["Once", "Once upon"]);
  });

  it("does not mark a non-streaming request", () => {
    const host = installMockHost();
    void generateText("hi").catch(() => {});
    const [, reqJson] = host.generate.mock.calls[0];
    expect(JSON.parse(reqJson)).not.toHaveProperty("stream");
    expect(JSON.parse(reqJson)).not.toHaveProperty("partialIntervalMs");
  });

  it("re-arms the inactivity watchdog on every partial", async () => {
    // The 60s bound is INACTIVITY, not total: a generation that is provably
    // decoding must not be killed mid-stream, while a silent one still can't
    // leak its promise (CX-022).
    vi.useFakeTimers();
    try {
      const host = installMockHost();
      let settled = false;
      const promise = generateText("long", { onPartial: () => {} });
      promise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const [id] = host.generate.mock.calls[0];
      await vi.advanceTimersByTimeAsync(59_000);
      dispatchNativeEvent(AI_PARTIAL_EVENT, { id, text: "still going" });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(settled).toBe(false);
      await expect(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
        await promise;
      }).rejects.toMatchObject({ code: "TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cancellation (signal)", () => {
  it("abort stops the native generation and rejects ABORTED", async () => {
    const host = installMockHost();
    const controller = new AbortController();
    const promise = generateText("hi", { signal: controller.signal });
    const [id] = host.generate.mock.calls[0];

    controller.abort();
    const error: AIError = await promise.catch((e) => e);
    expect(error.code).toBe("ABORTED");
    // The fetch shim's spelling, so one error.name branch serves both.
    expect(error.name).toBe("AbortError");
    // The model must STOP, not merely lose its resolve (ARCH-09: a popped
    // screen's generation is pure battery burn).
    expect(host.cancelGenerate).toHaveBeenCalledWith(id);

    // Settle-once: a native settle racing the abort is a silent no-op.
    resolveGenerate(id, "too late");
    await expect(promise).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("an already-aborted signal never starts the model", async () => {
    const host = installMockHost();
    const controller = new AbortController();
    controller.abort();
    const error: AIError = await generateText("hi", {
      signal: controller.signal,
    }).catch((e) => e);
    expect(error.code).toBe("ABORTED");
    expect(host.generate).not.toHaveBeenCalled();
    expect(host.cancelGenerate).not.toHaveBeenCalled();
  });
});

describe("structured output (generateObject)", () => {
  /** Every construct the closed subset supports, nested once — doubles as the
   *  committed Swift decode fixture. */
  const exercisePlan: AIObjectSchema = {
    type: "object",
    description: "one mobility exercise",
    properties: {
      title: { type: "string" },
      minutes: { type: "integer", description: "duration" },
      intensity: { type: "string", enum: ["easy", "moderate", "hard"] },
      perceivedEffort: { type: "number" },
      equipment: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: { type: "string" },
      },
      steps: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            instruction: { type: "string" },
            holdSeconds: { type: "integer" },
          },
          required: ["instruction"],
        },
      },
      outdoors: { type: "boolean" },
    },
    required: ["title", "minutes", "intensity", "steps"],
  };

  it("sends the schema as an ordered wire and resolves the parsed object", async () => {
    const host = installMockHost();
    const promise = generateObject<{ title: string; minutes: number }>(
      "Suggest one 10-minute mobility exercise",
      exercisePlan,
      { temperature: 0.2, maxTokens: 512 },
    );
    const [id, reqJson] = host.generate.mock.calls[0];
    const request = JSON.parse(reqJson);
    // No stream flag: a structured generation settles once.
    expect(request).not.toHaveProperty("stream");
    // JSON Schema's `properties` object becomes an ORDERED array on the wire
    // (guided generation follows it; a Swift dictionary decode would shuffle
    // it) and `required` folds into per-property `optional` flags —
    // `DynamicGenerationSchema.Property.isOptional`'s polarity.
    expect(
      request.schema.properties.map((p: { name: string }) => p.name),
    ).toEqual([
      "title",
      "minutes",
      "intensity",
      "perceivedEffort",
      "equipment",
      "steps",
      "outdoors",
    ]);
    const byName = new Map<string, { optional?: boolean }>(
      request.schema.properties.map((p: { name: string }) => [p.name, p]),
    );
    expect(byName.get("title")?.optional).toBeUndefined();
    expect(byName.get("perceivedEffort")?.optional).toBe(true);
    expect(byName.get("outdoors")?.optional).toBe(true);
    writeGenerateFixture("generate-object-request", reqJson);

    resolveGenerate(id, JSON.stringify({ title: "Hip circles", minutes: 10 }));
    expect(await promise).toEqual({ title: "Hip circles", minutes: 10 });
  });

  it("rejects DECODING_FAILURE when the resolve is not valid JSON", async () => {
    // "Malformed rejects typed, never garbage": a native bug (or a host that
    // resolved free text) must not hand the caller a string pretending to be
    // the object.
    const host = installMockHost();
    const promise = generateObject("p", {
      type: "object",
      properties: { a: { type: "string" } },
    });
    const [id] = host.generate.mock.calls[0];
    resolveGenerate(id, "Sure! Here's your object: {");
    await expect(promise).rejects.toMatchObject({ code: "DECODING_FAILURE" });
  });

  it("rejects INVALID_SCHEMA synchronously for schemas outside the subset", async () => {
    installMockHost();
    // Each breach names its node — the js walk mirrors AISchemaNode's.
    const cases: [AIObjectSchema, RegExp][] = [
      [
        {
          type: "object",
          properties: {
            when: { type: "date" } as never,
          },
        },
        /unsupported type "date"/,
      ],
      [
        {
          type: "object",
          properties: { n: { type: "integer", enum: ["a"] } as never },
        },
        /enum is only supported on type "string"/,
      ],
      [
        {
          type: "object",
          properties: { s: { type: "string", enum: [] } },
        },
        /enum must be a non-empty string array/,
      ],
      [
        {
          type: "object",
          properties: { list: { type: "array" } as never },
        },
        /array requires items/,
      ],
      [
        {
          type: "object",
          properties: {
            list: {
              type: "array",
              minItems: 3,
              maxItems: 1,
              items: { type: "string" },
            },
          },
        },
        /minItems > maxItems/,
      ],
      [
        {
          type: "object",
          properties: { a: { type: "string" } },
          required: ["b"],
        },
        /required names unknown property "b"/,
      ],
      [{ type: "array" } as never, /schema root must be type "object"/],
    ];
    for (const [schema, problem] of cases) {
      const error = await generateObject("p", schema).catch(
        (e) => e as AIError,
      );
      expect((error as AIError).code, JSON.stringify(schema)).toBe(
        "INVALID_SCHEMA",
      );
      expect((error as AIError).message).toMatch(problem);
    }
  });

  it("rejects UNAVAILABLE without an AI-capable host", async () => {
    const error = await generateObject("p", {
      type: "object",
      properties: { a: { type: "string" } },
    }).catch((e) => e as AIError);
    expect((error as AIError).code).toBe("UNAVAILABLE");
  });

  it("abort composes with generateObject through the shared channel", async () => {
    const host = installMockHost();
    const controller = new AbortController();
    const promise = generateObject(
      "p",
      { type: "object", properties: { a: { type: "string" } } },
      { signal: controller.signal },
    );
    const [id] = host.generate.mock.calls[0];
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "ABORTED" });
    expect(host.cancelGenerate).toHaveBeenCalledWith(id);
  });
});
