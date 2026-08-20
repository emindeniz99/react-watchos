[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthAuthorizationResult

# Type Alias: HealthAuthorizationResult

> **HealthAuthorizationResult** = `"prompted"` \| `"alreadyRequested"` \| `"unavailable"`

Defined in: [js/src/health.ts:62](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L62)

What [requestHealthAuthorization](../functions/requestHealthAuthorization.md) resolves with. Deliberately not a
 grant/deny verdict — HealthKit does not expose one for reads.
