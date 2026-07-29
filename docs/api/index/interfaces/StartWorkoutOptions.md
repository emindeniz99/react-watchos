[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / StartWorkoutOptions

# Interface: StartWorkoutOptions

Defined in: [js/src/workout.ts:75](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L75)

Options for [startWorkout](../functions/startWorkout.md).

## Properties

### collectRoute?

> `optional` **collectRoute?**: `boolean`

Defined in: [js/src/workout.ts:94](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L94)

Record an `HKWorkoutRoute` from the location stream. Needs the `location`
feature **as well as** `workouts` (a route is location data), and rejects
`POLICY_DENIED` naming `location` if the app's host policy withholds it.
The route rides the same `CLLocationManager` `startLocation` uses — no
second GPS stream — and is finished after the workout is saved.

***

### location?

> `optional` **location?**: `"indoor"` \| `"outdoor"`

Defined in: [js/src/workout.ts:79](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L79)

Indoor or outdoor. Not cosmetic: Apple states outdoor cycling generates
 accurate location data where indoor does not, and that calorimetry
 differs by location — it changes the numbers the workout records.

***

### metricsIntervalMs?

> `optional` **metricsIntervalMs?**: `number`

Defined in: [js/src/workout.ts:86](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L86)

How often `workout.metrics` is pushed, in ms. Default 1000, floor 250.
HealthKit collects samples at ~1 Hz and every push crosses the bridge and
can commit a render, so raise this as far as the UI tolerates — it is a
direct battery knob, like `startMotion`'s `updateIntervalMs`.
