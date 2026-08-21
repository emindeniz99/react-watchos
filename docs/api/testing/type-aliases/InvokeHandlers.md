[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [testing](../README.md) / InvokeHandlers

# Type Alias: InvokeHandlers

> **InvokeHandlers** = `Record`\<`string`, `unknown` \| ((`payload`, `method`) => `unknown`)\>

Defined in: [js/src/testing.ts:124](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L124)

Per-method outcomes for [installInvokeHost](../functions/installInvokeHost.md): a value resolves the
invoke with it; a function is called with the parsed payload (and the
method name) and its return value resolves — a THROWN `{ code, message }`
rejects the invoke with that error instead (a thrown `Error` rejects as
`INTERNAL` with its message). `undefined` — a method listed as `undefined`,
a handler returning `undefined`, or a method with no entry at all —
resolves the void wire (an empty result string, what native sends for a
`Void` op), so awaiters of side-effect methods see `undefined` exactly as
on-device. A `"*"` entry, when present, handles every method WITHOUT its
own entry: throw `{ code: "UNKNOWN_METHOD", … }` from it to mirror native's
reply for unrouted methods instead of the lenient void default.
