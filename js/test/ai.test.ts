import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIError, AIObjectSchema, AIToolCallContext } from "../src/index";
import {
  AI_PARTIAL_EVENT,
  AI_TOOL_CALL_EVENT,
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

describe("tool calling (tools)", () => {
  /** Drains the reply promise chain (execute → stringify → toolResult). */
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** An argument schema exercising enum + required through the tool wire. */
  const hydrationParameters: AIObjectSchema = {
    type: "object",
    properties: {
      unit: { type: "string", enum: ["glasses", "ml"] },
    },
    required: ["unit"],
  };

  it("declares tools on the wire in declaration order and resolves", async () => {
    const host = installMockHost();
    const seen: unknown[] = [];
    const promise = generateText("How is my hydration going?", {
      tools: {
        getHydration: {
          description: "Read today's water intake and the daily goal.",
          parameters: hydrationParameters,
          execute: (args) => {
            seen.push(args);
            return { glasses: 5, goal: 8 };
          },
        },
        // A no-argument tool: the empty-properties object is the smallest
        // legal parameters schema.
        getGoal: {
          parameters: { type: "object", properties: {} },
          execute: () => 8,
        },
      },
    });
    const [id, reqJson] = host.generate.mock.calls[0];
    const request = JSON.parse(reqJson);
    // The record becomes an ORDERED array (the properties-wire idiom):
    // declaration order is the order the definitions reach the prompt.
    expect(request.tools.map((t: { name: string }) => t.name)).toEqual([
      "getHydration",
      "getGoal",
    ]);
    expect(request.tools[0].description).toBe(
      "Read today's water intake and the daily goal.",
    );
    expect(request.tools[0].schema.properties[0].name).toBe("unit");
    expect(request.tools[1]).not.toHaveProperty("description");
    // `execute` is a runtime function — it must never be serialized (the
    // signal/onPartial rule applied to tools).
    expect(reqJson).not.toContain("execute");
    // The REAL tool-declaring request is the committed Swift decode fixture.
    writeGenerateFixture("generate-tools-request", reqJson);

    // Native asks for the tool mid-generation; the handler's result rides
    // back over the direct toolResult method as {result}.
    dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
      id,
      callId: 1,
      tool: "getHydration",
      argumentsJson: JSON.stringify({ unit: "glasses" }),
    });
    await flush();
    expect(seen).toEqual([{ unit: "glasses" }]);
    expect(host.toolResult).toHaveBeenCalledWith(
      id,
      1,
      JSON.stringify({ result: { glasses: 5, goal: 8 } }),
    );

    resolveGenerate(id, "5 of 8 glasses — keep going.");
    expect(await promise).toBe("5 of 8 glasses — keep going.");
  });

  it("hands the handler its call context (toolCallId + signal)", async () => {
    const host = installMockHost();
    let context: AIToolCallContext | undefined;
    void generateText("p", {
      tools: {
        t: {
          parameters: { type: "object", properties: {} },
          execute: (_args, ctx) => {
            context = ctx;
            return null;
          },
        },
      },
    }).catch(() => {});
    const [id] = host.generate.mock.calls[0];
    dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
      id,
      callId: 42,
      tool: "t",
      argumentsJson: "{}",
    });
    await flush();
    expect(context?.toolCallId).toBe(42);
    expect(context?.signal.aborted).toBe(false);
  });

  it("a throwing handler replies {error}; the native TOOL_FAILED lands typed", async () => {
    const host = installMockHost();
    const promise = generateText("p", {
      tools: {
        boom: {
          parameters: { type: "object", properties: {} },
          execute: () => {
            throw new Error("store unreachable");
          },
        },
      },
    });
    const [id] = host.generate.mock.calls[0];
    dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
      id,
      callId: 1,
      tool: "boom",
      argumentsJson: "{}",
    });
    await flush();
    expect(host.toolResult).toHaveBeenCalledWith(
      id,
      1,
      JSON.stringify({ error: "store unreachable" }),
    );
    // Native maps the failed call to a TOOL_FAILED reject — the closed
    // union's newest member must round-trip, not degrade to INTERNAL.
    rejectGenerate(
      id,
      JSON.stringify({
        code: "TOOL_FAILED",
        message: 'tool "boom" failed: store unreachable',
      }),
    );
    const error: AIError = await promise.catch((e) => e);
    expect(error.code).toBe("TOOL_FAILED");
    expect(error.message).toMatch(/store unreachable/);
  });

  it("an async rejecting handler takes the same {error} path", async () => {
    const host = installMockHost();
    void generateText("p", {
      tools: {
        later: {
          parameters: { type: "object", properties: {} },
          execute: async () => {
            throw new Error("later");
          },
        },
      },
    }).catch(() => {});
    const [id] = host.generate.mock.calls[0];
    dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
      id,
      callId: 2,
      tool: "later",
      argumentsJson: "{}",
    });
    await flush();
    expect(host.toolResult).toHaveBeenCalledWith(
      id,
      2,
      JSON.stringify({ error: "later" }),
    );
  });

  it("normalizes an undefined result to {result: null}", async () => {
    const host = installMockHost();
    void generateText("p", {
      tools: {
        fireAndForget: {
          parameters: { type: "object", properties: {} },
          execute: () => undefined,
        },
      },
    }).catch(() => {});
    const [id] = host.generate.mock.calls[0];
    dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
      id,
      callId: 3,
      tool: "fireAndForget",
      argumentsJson: "{}",
    });
    await flush();
    // JSON.stringify({result: undefined}) would drop the key and hand native
    // a reply it must treat as malformed; null is the honest encoding.
    expect(host.toolResult).toHaveBeenCalledWith(
      id,
      3,
      JSON.stringify({ result: null }),
    );
  });

  it("an unknown tool name fails THE CALL typed (bridge-bug backstop)", async () => {
    // The model can only call declared tools, so this is a native/bridge bug
    // — but replying {error} keeps the generation rejecting TOOL_FAILED
    // instead of leaving the native continuation parked until the watchdog.
    const host = installMockHost();
    void generateText("p", {
      tools: {
        real: {
          parameters: { type: "object", properties: {} },
          execute: () => null,
        },
      },
    }).catch(() => {});
    const [id] = host.generate.mock.calls[0];
    dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
      id,
      callId: 4,
      tool: "imaginary",
      argumentsJson: "{}",
    });
    await flush();
    expect(host.toolResult).toHaveBeenCalledWith(
      id,
      4,
      JSON.stringify({ error: 'unknown tool "imaginary"' }),
    );
  });

  it("malformed arguments JSON fails the call, not the runtime", async () => {
    const host = installMockHost();
    const seen: unknown[] = [];
    void generateText("p", {
      tools: {
        t: {
          parameters: { type: "object", properties: {} },
          execute: (args) => {
            seen.push(args);
            return null;
          },
        },
      },
    }).catch(() => {});
    const [id] = host.generate.mock.calls[0];
    dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
      id,
      callId: 5,
      tool: "t",
      argumentsJson: "{not json",
    });
    await flush();
    expect(seen).toEqual([]);
    expect(host.toolResult).toHaveBeenCalledWith(
      id,
      5,
      JSON.stringify({ error: 'tool "t": malformed arguments JSON' }),
    );
  });

  it("ignores another request's tool call and a call after settle", async () => {
    const host = installMockHost();
    let runs = 0;
    const promise = generateText("p", {
      tools: {
        t: {
          parameters: { type: "object", properties: {} },
          execute: () => {
            runs += 1;
            return null;
          },
        },
      },
    });
    const [id] = host.generate.mock.calls[0];
    dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
      id: id + 999,
      callId: 1,
      tool: "t",
      argumentsJson: "{}",
    });
    resolveGenerate(id, "done");
    expect(await promise).toBe("done");
    // The listener is torn down with the settle: a late call runs nothing.
    dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
      id,
      callId: 2,
      tool: "t",
      argumentsJson: "{}",
    });
    await flush();
    expect(runs).toBe(0);
    expect(host.toolResult).not.toHaveBeenCalled();
  });

  it("abort mid-call rejects ABORTED, aborts the tool signal, drops the late reply", async () => {
    const host = installMockHost();
    const controller = new AbortController();
    let context: AIToolCallContext | undefined;
    let signalFired = false;
    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const promise = generateText("p", {
      signal: controller.signal,
      tools: {
        slow: {
          parameters: { type: "object", properties: {} },
          execute: (_args, ctx) => {
            context = ctx;
            ctx.signal.addEventListener("abort", () => {
              signalFired = true;
            });
            return gate;
          },
        },
      },
    });
    const [id] = host.generate.mock.calls[0];
    dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
      id,
      callId: 1,
      tool: "slow",
      argumentsJson: "{}",
    });
    await flush();

    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "ABORTED" });
    // The generation's abort reaches the pending tool work: the model was
    // stopped natively AND the handler's own async work sees the signal.
    expect(host.cancelGenerate).toHaveBeenCalledWith(id);
    expect(context?.signal.aborted).toBe(true);
    expect(signalFired).toBe(true);

    // The handler eventually settles anyway — its reply must go nowhere
    // (native already failed the parked call).
    release(null);
    await flush();
    expect(host.toolResult).not.toHaveBeenCalled();
  });

  it("a tool call and its reply both re-arm the inactivity watchdog", async () => {
    vi.useFakeTimers();
    try {
      const host = installMockHost();
      let settled = false;
      const promise = generateText("p", {
        tools: {
          t: {
            parameters: { type: "object", properties: {} },
            execute: () => null,
          },
        },
      });
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
      // The model is provably alive — it just asked for a tool.
      dispatchNativeEvent(AI_TOOL_CALL_EVENT, {
        id,
        callId: 1,
        tool: "t",
        argumentsJson: "{}",
      });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(settled).toBe(false);
      expect(host.toolResult).toHaveBeenCalled();
      // …but a silent post-reply minute is still the watchdog's business.
      await expect(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
        await promise;
      }).rejects.toMatchObject({ code: "TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects INVALID_SCHEMA synchronously for bad tool declarations", async () => {
    installMockHost();
    const cases: [Record<string, unknown>, RegExp][] = [
      [
        {
          bad: {
            parameters: { type: "string" },
            execute: () => null,
          },
        },
        /tools\.bad: parameters root must be type "object"/,
      ],
      [
        {
          nested: {
            parameters: {
              type: "object",
              properties: { when: { type: "date" } },
            },
            execute: () => null,
          },
        },
        /tools\.nested\.when: unsupported type "date"/,
      ],
      [
        {
          "": {
            parameters: { type: "object", properties: {} },
            execute: () => null,
          },
        },
        /tool name must not be empty/,
      ],
    ];
    for (const [tools, problem] of cases) {
      const error: AIError = await generateText("p", {
        tools: tools as never,
      }).catch((e) => e);
      expect(error.code, JSON.stringify(tools)).toBe("INVALID_SCHEMA");
      expect(error.message).toMatch(problem);
    }
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
