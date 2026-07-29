[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HeartRateOptions

# Interface: HeartRateOptions

Defined in: [js/src/sensors.ts:102](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L102)

Options for [startHeartRate](../functions/startHeartRate.md).

## Properties

### keepAliveInBackground?

> `optional` **keepAliveInBackground?**: `boolean`

Defined in: [js/src/sensors.ts:112](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L112)

Keep the heart-rate stream running when the app backgrounds. Default
`false`: the native side ends the underlying HealthKit workout session on
background (so the app suspends instead of staying alive with the sensor
hot) and restarts it on foreground — so a forgotten stop can't drain the
battery indefinitely. Set `true` only for a genuine background use case
(e.g. an active workout). While the stream is shared, only the FIRST
subscriber's value takes effect.
