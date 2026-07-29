[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SensorKind

# Type Alias: SensorKind

> **SensorKind** = `"heartRate"` \| `"motion"` \| `"gyroscope"` \| `"location"`

Defined in: [js/src/sensors.ts:30](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L30)

The sensor streams the native bridge actually implements. Closed on purpose:
`SensorBridge.handleOp` switches on exactly these four and `default: break`s,
so any other kind starts nothing and silently never emits. This union used to
end in `| string`, which made `startSensor("steps", cb)` type-check, return a
plausible unsubscribe, and no-op forever — a skipped feature at the type
level. An unknown kind is now a compile error instead.
