[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / MessageContract

# Type Alias: MessageContract

> **MessageContract** = `Record`\<`string`, `unknown`\>

Defined in: [js/src/connectivity.ts:40](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/connectivity.ts#L40)

A phone<->watch message contract (DX-6): each key is a message name, its value
the payload type. Declare it once and share the same `T` on both sides (this
watch package and the iPhone companion) so messaging is type-checked end to
end instead of hand-rolled JSON.
