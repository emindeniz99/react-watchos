[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / BleWriteOptions

# Interface: BleWriteOptions

Defined in: [js/src/bluetooth.ts:87](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/bluetooth.ts#L87)

Options for [bleWrite](../functions/bleWrite.md).

## Properties

### confirm?

> `optional` **confirm?**: `boolean`

Defined in: [js/src/bluetooth.ts:94](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/bluetooth.ts#L94)

Reliable write (CoreBluetooth `.withResponse`): the peripheral acks
delivery, so the command can't be silently dropped under buffer pressure —
at a small latency cost. Omit to let the bridge default to reliable when
the characteristic supports it, else a fast unacknowledged write.
