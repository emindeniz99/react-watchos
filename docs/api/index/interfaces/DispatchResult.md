[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / DispatchResult

# Interface: DispatchResult

Defined in: [js/src/renderer.ts:31](https://github.com/emindeniz99/react-watchos/blob/main/js/src/renderer.ts#L31)

Structured result of a native event dispatch (ARCH-09), returned to Swift as
a JSON string by `__dispatchEvent` so navigation can be a request/confirm
transaction instead of a fire-and-forget.

 - `handled` — a handler prop existed and ran (the old boolean).
 - `accepted` — the *proposal* took effect. For `pathChange` this is a
   post-flush comparison of the stack's committed path against the proposed
   one; for every other event it mirrors `handled`.
 - `reason` — why `accepted` is false, when it is.

A thrown handler produces NO result (the exception propagates out of
`__dispatchEvent`); Swift maps that, like a missing global, to a rollback.

## Properties

### accepted

> **accepted**: `boolean`

Defined in: [js/src/renderer.ts:33](https://github.com/emindeniz99/react-watchos/blob/main/js/src/renderer.ts#L33)

***

### handled

> **handled**: `boolean`

Defined in: [js/src/renderer.ts:32](https://github.com/emindeniz99/react-watchos/blob/main/js/src/renderer.ts#L32)

***

### reason?

> `optional` **reason?**: `string`

Defined in: [js/src/renderer.ts:34](https://github.com/emindeniz99/react-watchos/blob/main/js/src/renderer.ts#L34)
