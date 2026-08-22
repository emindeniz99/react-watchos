[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ParamsOf

# Type Alias: ParamsOf\<S\>

> **ParamsOf**\<`S`\> = `{ [K in keyof SegsParams<S>]: SegsParams<S>[K] }`

Defined in: [js/src/navigation.tsx:242](https://github.com/emindeniz99/react-watchos/blob/main/js/src/navigation.tsx#L242)

Params inferred from a route template: `ParamsOf<"/list/[id]">` = `{ id: string }`.

## Type Parameters

### S

`S` *extends* `string`
