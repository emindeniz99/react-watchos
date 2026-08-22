[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / GenerateOptions

# Interface: GenerateOptions

Defined in: [js/src/ai.ts:197](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L197)

Options for [generateText](../functions/generateText.md).

## Properties

### instructions?

> `optional` **instructions?**: `string`

Defined in: [js/src/ai.ts:203](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L203)

Optional system instructions for the session.

***

### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [js/src/ai.ts:201](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L201)

Cap on the response length (`GenerationOptions.maximumResponseTokens`).

***

### onPartial?

> `optional` **onPartial?**: (`text`) => `void`

Defined in: [js/src/ai.ts:212](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L212)

Streaming: called with the CUMULATIVE text so far as the model decodes
(Apple's `streamResponse` snapshots, not deltas — a snapshot is directly
renderable and a coalesced push self-heals, where a lost delta corrupts
everything after it). The promise still resolves with the complete text,
so streaming composes with the non-streaming call sites instead of
forking a second entry point.

#### Parameters

##### text

`string`

#### Returns

`void`

***

### partialIntervalMs?

> `optional` **partialIntervalMs?**: `number`

Defined in: [js/src/ai.ts:219](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L219)

Coalescing floor for [onPartial](#onpartial), ms. Not a decode rate: the model
decodes at its own pace, and this only bounds how often a snapshot may
CROSS the bridge — every push commits a render, so raise it as far as
your UI tolerates (the `metricsIntervalMs` idiom). Native default 250.

***

### signal?

> `optional` **signal?**: [`AbortSignalLike`](AbortSignalLike.md)

Defined in: [js/src/ai.ts:236](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L236)

Abort like fetch: generation stops natively (the model quits decoding —
on a watch the ~3B model is the most expensive thing to leave running)
and the promise rejects `ABORTED` with `name: "AbortError"`. Wire it to
an effect cleanup so a screen popping mid-generation cancels its own
request (ARCH-09 focus rules):

```ts
useEffect(() => {
  const ac = new AbortController();
  generateText("Summarize", { signal: ac.signal }).then(setText,
    (e) => { if (e.code !== "ABORTED") setError(e); });
  return () => ac.abort();
}, []);
```

***

### temperature?

> `optional` **temperature?**: `number`

Defined in: [js/src/ai.ts:199](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L199)

0–1; higher = more creative.

***

### tools?

> `optional` **tools?**: `Record`\<`string`, [`AITool`](AITool.md)\>

Defined in: [js/src/ai.ts:260](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L260)

Tools the model may invoke while it generates — the round trip is
model → native pause → JS handler → native resume, so a tool can read
app state, call host APIs, even fetch:

```ts
const text = await generateText("How is my hydration going?", {
  tools: {
    getHydration: {
      description: "Read today's water intake and the daily goal.",
      parameters: { type: "object", properties: {} },
      execute: () => ({ glasses: store.glasses, goal: store.goal }),
    },
  },
});
```

Composes with [onPartial](#onpartial) (snapshots pause while a tool runs) and
[signal](#signal) (aborting also aborts pending tool calls via
[AIToolCallContext.signal](AIToolCallContext.md#signal)). Tool definitions spend context window —
Apple puts every declared tool's name/description/schema in the prompt —
so declare only what the prompt needs.
