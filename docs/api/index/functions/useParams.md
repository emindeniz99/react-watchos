[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / useParams

# Function: useParams()

> **useParams**\<`T`\>(): `T` *extends* `string` ? [`ParamsOf`](../type-aliases/ParamsOf.md)\<`T`\> : `T`

Defined in: [js/src/navigation.tsx:195](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/navigation.tsx#L195)

Dynamic-segment params of the active route. Pass the route TEMPLATE to infer
the shape (`useParams<"/list/[id]">()` -> `{ id: string }`), or an explicit
shape, or nothing for the open default.

## Type Parameters

### T

`T` *extends* `string` \| [`RouteParams`](../type-aliases/RouteParams.md) = [`RouteParams`](../type-aliases/RouteParams.md)

## Returns

`T` *extends* `string` ? [`ParamsOf`](../type-aliases/ParamsOf.md)\<`T`\> : `T`
