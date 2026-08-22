[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / renderToTree

# Function: renderToTree()

> **renderToTree**(`element`): [`SerializedNode`](../interfaces/SerializedNode.md) \| `null`

Defined in: [js/src/staticRender.ts:432](https://github.com/emindeniz99/react-watchos/blob/main/js/src/staticRender.ts#L432)

One-shot render: element in, serialized tree out. No host, no reconciler, no
events — see this module's header for what that costs and what it buys.

The single-root rule and every byte of the wire mapping come from
`serializeTree` in serialize.ts, shared verbatim with the app's fiber path.

## Parameters

### element

`ReactNode`

## Returns

[`SerializedNode`](../interfaces/SerializedNode.md) \| `null`
