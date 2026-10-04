[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AIErrorCode

# Type Alias: AIErrorCode

> **AIErrorCode** = `"UNAVAILABLE"` \| `"GUARDRAIL_VIOLATION"` \| `"CONTEXT_WINDOW_EXCEEDED"` \| `"UNSUPPORTED_LANGUAGE"` \| `"DECODING_FAILURE"` \| `"RATE_LIMITED"` \| `"CONCURRENT_REQUESTS"` \| `"REFUSAL"` \| `"INVALID_SCHEMA"` \| `"TOOL_FAILED"` \| `"NETWORK_FAILURE"` \| `"QUOTA_LIMIT_REACHED"` \| `"SERVICE_UNAVAILABLE"` \| `"ABORTED"` \| `"TIMEOUT"` \| `"INTERNAL"`

Defined in: [js/src/ai.ts:56](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L56)

The closed set of codes an AI generation may reject with — the TS half of
`AIErrorCode` in ReactWatchSupport (AIPlan.swift), same discipline as
`InvokeErrorCode`. `ABORTED` and `DECODING_FAILURE` are minted on this side
(the abort signal, a structured result that is not JSON), `TIMEOUT` on
both (the inactivity watchdog here, `LanguageModelError.timeout` natively).
The rest arrive from native, mapped from FoundationModels'
`LanguageModelError`, `PrivateCloudComputeLanguageModel.Error` and
`LanguageModelSession.Error`; `TOOL_FAILED` when one of your tool handlers
failed.

- `NETWORK_FAILURE`: the request could not reach Private Cloud Compute.
  The watch has no on-device model to fall back to; retry when online.
- `QUOTA_LIMIT_REACHED`: the person used up their daily request quota.
  Unlike `RATE_LIMITED`, retrying soon does not help: the quota refreshes
  later, or the person upgrades their iCloud+ plan.
- `SERVICE_UNAVAILABLE`: Private Cloud Compute could not take the request.
