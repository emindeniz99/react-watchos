[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HEALTH\_UPDATE\_EVENT\_PREFIX

# Variable: HEALTH\_UPDATE\_EVENT\_PREFIX

> `const` **HEALTH\_UPDATE\_EVENT\_PREFIX**: `"health.samples."` = `"health.samples."`

Defined in: [js/src/health.ts:587](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L587)

The native-event name prefix a live stream's samples arrive on:
 `health.samples.<type>`, e.g. `health.samples.heartRate`.

 Exported because it is an **unchecked string on both sides** — a JS constant
 here, a Swift literal in `HealthUpdatesPlan.eventPrefix` — and nothing
 compares them at compile time: a typo in either yields a subscription that
 never fires, with no error anywhere to say why. `health-package-guards.test`
 pins the two against each other, and it can only do that if the JS half is a
 named constant rather than an inline template string.

 Exported from the package the way every other event name is
 (`SENSOR_EVENT_PREFIX`, `WORKOUT_METRICS_EVENT`), though a caller has little
 use for it: [startHealthUpdates](../functions/startHealthUpdates.md) builds the name and narrows the
 payload, and a raw `registerNativeListener` on it gets neither.
