[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / MotionOptions

# Interface: MotionOptions

Defined in: [js/src/sensors.ts:206](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/sensors.ts#L206)

Options for [startMotion](../functions/startMotion.md) / [startGyroscope](../functions/startGyroscope.md).

## Properties

### updateIntervalMs?

> `optional` **updateIntervalMs?**: `number`

Defined in: [js/src/sensors.ts:213](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/sensors.ts#L213)

Update period in ms. Default 100 (10 Hz). Every reading crosses the
bridge and can commit a render, so raise this as far as your use case
tolerates — it is a direct battery knob. Only the FIRST subscriber's
value takes effect (the native stream is shared).
