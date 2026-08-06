[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / RUNTIME\_STATE\_EVENT

# Variable: RUNTIME\_STATE\_EVENT

> `const` **RUNTIME\_STATE\_EVENT**: `"runtimeSession.state"` = `"runtimeSession.state"`

Defined in: [js/src/extendedRuntime.ts:19](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/extendedRuntime.ts#L19)

Extended runtime session (WKExtendedRuntimeSession): keeps the app running
for a bounded stretch after it would normally suspend — for a self-care /
mindfulness / physical-therapy style session where the screen may sleep but
your logic must keep ticking. Not a workout session (that's HealthKit +
sensors); this is the general "stay alive briefly" primitive.

State transitions arrive on the push channel as `runtimeSession.state`
(`{ state: "running" | "invalidated", reason? }`) and an early-warning
`runtimeSession.willExpire` shortly before the system reclaims it.
