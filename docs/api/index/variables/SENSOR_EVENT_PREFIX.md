[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SENSOR\_EVENT\_PREFIX

# Variable: SENSOR\_EVENT\_PREFIX

> `const` **SENSOR\_EVENT\_PREFIX**: `"sensor."` = `"sensor."`

Defined in: [js/src/sensors.ts:15](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/sensors.ts#L15)

Live sensor streams (heart rate via HealthKit, motion via CoreMotion).
start a kind and readings arrive on the native-event push channel as
`sensor.<kind>` (so each reading commits instantly via runSync). The
watch's standout app shape is sensor + complication, and this rides
watchOS 26's expanded real-time fitness APIs.
