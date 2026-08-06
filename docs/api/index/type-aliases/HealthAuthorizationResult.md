[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthAuthorizationResult

# Type Alias: HealthAuthorizationResult

> **HealthAuthorizationResult** = `"prompted"` \| `"alreadyRequested"` \| `"unavailable"`

Defined in: [js/src/health.ts:61](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L61)

What [requestHealthAuthorization](../functions/requestHealthAuthorization.md) resolves with. Deliberately not a
 grant/deny verdict — HealthKit does not expose one for reads.
