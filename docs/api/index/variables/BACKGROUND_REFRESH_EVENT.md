[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / BACKGROUND\_REFRESH\_EVENT

# Variable: BACKGROUND\_REFRESH\_EVENT

> `const` **BACKGROUND\_REFRESH\_EVENT**: `"backgroundRefresh"` = `"backgroundRefresh"`

Defined in: [js/src/background.ts:17](https://github.com/emindeniz99/react-watchos/blob/main/js/src/background.ts#L17)

Background app refresh (WKApplicationRefreshBackgroundTask): schedule a
wake-up, and when watchOS runs it the app is briefly alive to refresh data
(fetch, republish complications) before suspending again. The fire arrives
on the native-event push channel as `backgroundRefresh` with your userInfo.

watchOS budgets these (roughly hourly for an active app); treat the interval
as a hint. Do your refresh, then optionally reschedule for the next one.
