[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AbortSignalLike

# Interface: AbortSignalLike

Defined in: [js/src/ai.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L104)

The structural slice of `AbortSignal` this module needs — satisfied by the
runtime's fetch-installed shim (`WatchAbortSignal`), by DOM/Node signals in
tests, and by anything a caller hands in. Structural on purpose: `ai.ts`
must not import the fetch shim's class (the shim installs lazily and only
when the engine lacks fetch), and a nominal type would reject platform
signals that work fine.

## Properties

### aborted

> `readonly` **aborted**: `boolean`

Defined in: [js/src/ai.ts:105](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L105)

***

### reason?

> `readonly` `optional` **reason?**: `unknown`

Defined in: [js/src/ai.ts:106](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L106)

## Methods

### addEventListener()

> **addEventListener**(`type`, `listener`): `void`

Defined in: [js/src/ai.ts:107](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L107)

#### Parameters

##### type

`"abort"`

##### listener

() => `void`

#### Returns

`void`

***

### removeEventListener()

> **removeEventListener**(`type`, `listener`): `void`

Defined in: [js/src/ai.ts:108](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L108)

#### Parameters

##### type

`"abort"`

##### listener

() => `void`

#### Returns

`void`
