[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AIErrorCode

# Type Alias: AIErrorCode

> **AIErrorCode** = `"UNAVAILABLE"` \| `"GUARDRAIL_VIOLATION"` \| `"CONTEXT_WINDOW_EXCEEDED"` \| `"UNSUPPORTED_LANGUAGE"` \| `"DECODING_FAILURE"` \| `"RATE_LIMITED"` \| `"CONCURRENT_REQUESTS"` \| `"REFUSAL"` \| `"INVALID_SCHEMA"` \| `"TOOL_FAILED"` \| `"ABORTED"` \| `"TIMEOUT"` \| `"INTERNAL"`

Defined in: [js/src/ai.ts:40](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L40)

The closed set of codes an AI generation may reject with — the TS half of
`AIErrorCode` in ReactWatchSupport (AIPlan.swift), same discipline as
`InvokeErrorCode`. `ABORTED` and `TIMEOUT` are minted on this side (the
abort signal, the inactivity watchdog); everything else arrives from
native, mapped from FoundationModels' `GenerationError` cases —
`TOOL_FAILED` from `LanguageModelSession.ToolCallError`, the wrapper the
framework rethrows when a tool's own call (a JS handler here) fails.
