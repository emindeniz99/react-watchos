[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / GenerateOptions

# Interface: GenerateOptions

Defined in: [js/src/ai.ts:219](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L219)

Options for [generateText](../functions/generateText.md).

## Properties

### instructions?

> `optional` **instructions?**: `string`

Defined in: [js/src/ai.ts:225](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L225)

Optional system instructions for the session.

***

### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [js/src/ai.ts:223](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L223)

Cap on the response length (`GenerationOptions.maximumResponseTokens`).

***

### onPartial?

> `optional` **onPartial?**: (`text`) => `void`

Defined in: [js/src/ai.ts:234](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L234)

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

Defined in: [js/src/ai.ts:241](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L241)

Coalescing floor for [onPartial](#onpartial), ms. Not a decode rate: the model
decodes at its own pace, and this only bounds how often a snapshot may
CROSS the bridge — every push commits a render, so raise it as far as
your UI tolerates (the `metricsIntervalMs` idiom). Native default 250.

***

### signal?

> `optional` **signal?**: [`AbortSignalLike`](AbortSignalLike.md)

Defined in: [js/src/ai.ts:258](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L258)

Abort like fetch: generation stops natively (the request to Private
Cloud Compute is cancelled, so a screen that is gone stops spending the
radio and the person's quota) and the promise rejects `ABORTED` with `name: "AbortError"`. Wire it to
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

Defined in: [js/src/ai.ts:221](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L221)

0–1; higher = more creative.

***

### tools?

> `optional` **tools?**: `Record`\<`string`, [`AITool`](AITool.md)\>

Defined in: [js/src/ai.ts:282](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L282)

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
