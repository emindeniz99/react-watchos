[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SensorKind

# Type Alias: SensorKind

> **SensorKind** = `"heartRate"` \| `"motion"` \| `"gyroscope"` \| `"location"` \| `"pedometer"`

Defined in: [js/src/sensors.ts:38](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/sensors.ts#L38)

The sensor streams the native bridge actually implements. Closed on purpose:
`SensorBridge.handleOp` switches on exactly these five and `default: break`s,
so any other kind starts nothing and silently never emits. This union used to
end in `| string`, which made `startSensor("steps", cb)` type-check, return a
plausible unsubscribe, and no-op forever — a skipped feature at the type
level. An unknown kind is now a compile error instead.

WIDENING THIS UNION REQUIRES ADDING THE MATCHING `handleOp` CASE IN THE SAME
CHANGE. The Swift switch's `default: break` is deliberate forward-compat, so
a kind added here alone compiles, type-checks, lints, and no-ops forever —
which is precisely what the compile guard in test/sensors.test.tsx exists to
stop, and it cannot see a half-done widening.
