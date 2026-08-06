[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [testing](../README.md) / InvokeHandlers

# Type Alias: InvokeHandlers

> **InvokeHandlers** = `Record`\<`string`, `unknown` \| ((`payload`) => `unknown`)\>

Defined in: [js/src/testing.ts:117](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L117)

Per-method outcomes for [installInvokeHost](../functions/installInvokeHost.md): a value resolves the
invoke with it; a function is called with the parsed payload and its return
value resolves — and a THROWN `{ code, message }` rejects the invoke with
that error instead. Methods not listed resolve `null`.
