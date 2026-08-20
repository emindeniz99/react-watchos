[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ActivityMoveMode

# Type Alias: ActivityMoveMode

> **ActivityMoveMode** = `WireActivitySummary`\[`"moveMode"`\]

Defined in: [js/src/health.ts:98](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L98)

Which quantity the **move** ring measures (`HKActivityMoveMode`).

 `"activeEnergy"` is the calorie ring most people close. `"appleMoveTime"` is
 the minutes ring under-18 accounts get — and anyone who chose Move Time in
 Settings — where [ActivitySummary.activeEnergyKcal](../interfaces/ActivitySummary.md#activeenergykcal) is *not* what the
 watch scored them on. Branch on this before drawing the move ring.
