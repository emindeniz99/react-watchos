[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AbortSignalLike

# Interface: AbortSignalLike

Defined in: [js/src/ai.ts:97](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L97)

The structural slice of `AbortSignal` this module needs — satisfied by the
runtime's fetch-installed shim (`WatchAbortSignal`), by DOM/Node signals in
tests, and by anything a caller hands in. Structural on purpose: `ai.ts`
must not import the fetch shim's class (the shim installs lazily and only
when the engine lacks fetch), and a nominal type would reject platform
signals that work fine.

## Properties

### aborted

> `readonly` **aborted**: `boolean`

Defined in: [js/src/ai.ts:98](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L98)

***

### reason?

> `readonly` `optional` **reason?**: `unknown`

Defined in: [js/src/ai.ts:99](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L99)

## Methods

### addEventListener()

> **addEventListener**(`type`, `listener`): `void`

Defined in: [js/src/ai.ts:100](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L100)

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

Defined in: [js/src/ai.ts:101](https://github.com/emindeniz99/react-watchos/blob/main/js/src/ai.ts#L101)

#### Parameters

##### type

`"abort"`

##### listener

() => `void`

#### Returns

`void`
