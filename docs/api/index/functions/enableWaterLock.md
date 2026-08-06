[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / enableWaterLock

# Function: enableWaterLock()

> **enableWaterLock**(): `Promise`\<`void`\>

Defined in: [js/src/device.ts:53](https://github.com/emindeniz99/react-watchos/blob/main/js/src/device.ts#L53)

Enables Water Lock (SwiftUI-less): locks the touch screen so submersion
can't register taps; the user turns the crown to unlock and the watch
ejects water. Only works on a water-resistant watch (wr50); rejects
otherwise.

## Returns

`Promise`\<`void`\>
