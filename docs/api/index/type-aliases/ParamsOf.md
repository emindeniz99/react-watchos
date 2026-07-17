[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ParamsOf

# Type Alias: ParamsOf\<S\>

> **ParamsOf**\<`S`\> = `{ [K in keyof SegsParams<S>]: SegsParams<S>[K] }`

Defined in: [js/src/navigation.tsx:234](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/navigation.tsx#L234)

Params inferred from a route template: `ParamsOf<"/list/[id]">` = `{ id: string }`.

## Type Parameters

### S

`S` *extends* `string`
