[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SENSOR\_EVENT\_PREFIX

# Variable: SENSOR\_EVENT\_PREFIX

> `const` **SENSOR\_EVENT\_PREFIX**: `"sensor."` = `"sensor."`

Defined in: [js/src/sensors.ts:22](https://github.com/emindeniz99/react-watchos/blob/main/js/src/sensors.ts#L22)

Live sensor streams (heart rate via HealthKit, motion/gyroscope via
CoreMotion, location via CoreLocation). start a kind and readings arrive on
the native-event push channel as `sensor.<kind>` (so each reading commits
instantly via runSync). The watch's standout app shape is sensor +
complication.

No watchOS 26 API is involved: the bridge uses `HKWorkoutSession` (2.0),
`HKLiveWorkoutDataSource` (5.0), `HKQuantityType(.heartRate)` (2.0),
`CMMotionManager` (2.0) and `CLLocationManager` — every one of them far
below this project's watchOS 10 floor.
