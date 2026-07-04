[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / BleWriteOptions

# Interface: BleWriteOptions

Defined in: [js/src/bluetooth.ts:54](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/bluetooth.ts#L54)

Options for [bleWrite](../functions/bleWrite.md).

## Properties

### confirm?

> `optional` **confirm?**: `boolean`

Defined in: [js/src/bluetooth.ts:61](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/bluetooth.ts#L61)

Reliable write (CoreBluetooth `.withResponse`): the peripheral acks
delivery, so the command can't be silently dropped under buffer pressure —
at a small latency cost. Omit to let the bridge default to reliable when
the characteristic supports it, else a fast unacknowledged write.
