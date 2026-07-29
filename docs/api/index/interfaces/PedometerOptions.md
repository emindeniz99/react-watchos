[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / PedometerOptions

# Interface: PedometerOptions

Defined in: [js/src/sensors.ts:150](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L150)

Options for [startPedometer](../functions/startPedometer.md).

## Properties

### fromMs?

> `optional` **fromMs?**: `number`

Defined in: [js/src/sensors.ts:157](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L157)

Count from this instant (ms since epoch) instead of from now — CoreMotion
back-fills from its ~7-day on-device history, so `fromMs: startOfDay` gives
today's running total immediately rather than counting up from zero.
Only the FIRST subscriber's value takes effect (the stream is shared).
