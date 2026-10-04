[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AIAvailability

# Type Alias: AIAvailability

> **AIAvailability** = `"available"` \| `"deviceNotEligible"` \| `"systemNotReady"` \| `"unsupported"`

Defined in: [js/src/ai.ts:603](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L603)

What [getAIAvailability](../functions/getAIAvailability.md) resolves — the state of
`PrivateCloudComputeLanguageModel.availability`, plus `unsupported`:

- `available`: generation can be attempted. It can still fail with
  `NETWORK_FAILURE` or `QUOTA_LIMIT_REACHED`; Apple keeps quota separate
  from availability.
- `deviceNotEligible`: this device or region doesn't support Apple
  Intelligence. Show an alternative UI.
- `systemNotReady`: Private Cloud Compute isn't ready to serve requests
  yet; check again later.
- `unsupported`: there is no model to ask — no AI-capable host
  (tests/Node/widget), watchOS below 27, a build without the watchOS 27
  SDK, or an unavailable reason newer than this library.
