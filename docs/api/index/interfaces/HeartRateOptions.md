[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HeartRateOptions

# Interface: HeartRateOptions

Defined in: [js/src/sensors.ts:115](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L115)

Options for [startHeartRate](../functions/startHeartRate.md).

## Properties

### keepAliveInBackground?

> `optional` **keepAliveInBackground?**: `boolean`

Defined in: [js/src/sensors.ts:132](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L132)

Keep the heart-rate stream running when the app backgrounds. Default
`false`: the native side ends the underlying HealthKit workout session on
background (so the app suspends instead of staying alive with the sensor
hot) and restarts it on foreground — so a forgotten stop can't drain the
battery indefinitely. Set `true` only for a genuine background use case
(e.g. an active workout). While the stream is shared, only the FIRST
subscriber's value takes effect.

The rule holds through the workout API too: a `startWorkout` **pins** the
session while it runs (that is what a workout is), but if it ends while the
app is backgrounded, the stream stays down until the next foreground rather
than starting a fresh session behind the user's back. A stream lost to an
outside event — Apple ends our session when a second workout starts
elsewhere — also comes back on the next foreground.
