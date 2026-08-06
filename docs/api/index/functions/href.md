[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / href

# Function: href()

> **href**\<`S`\>(`template`, `params`): `string`

Defined in: [js/src/navigation.tsx:255](https://github.com/emindeniz99/react-watchos/blob/main/js/src/navigation.tsx#L255)

Build a concrete path from a route template and type-checked params:
`href("/list/[id]", { id: "42" })` -> `"/list/42"`. The params type is
inferred from the template, so a missing or misnamed key is a compile error.

## Type Parameters

### S

`S` *extends* `string`

## Parameters

### template

`S`

### params

[`ParamsOf`](../type-aliases/ParamsOf.md)\<`S`\>

## Returns

`string`
