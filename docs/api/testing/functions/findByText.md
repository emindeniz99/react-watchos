[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [testing](../README.md) / findByText

# Function: findByText()

> **findByText**(`node`, `text`): [`SerializedNode`](../../index/interfaces/SerializedNode.md)[]

Defined in: [js/src/testing.ts:27](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/testing.ts#L27)

All nodes whose folded text (`props.text`) matches. A string matches by
exact equality; a RegExp by `.test()`. Because `<Text>` content lives in
`props.text`, this is how you assert on rendered copy.

## Parameters

### node

[`SerializedNode`](../../index/interfaces/SerializedNode.md)

### text

`string` \| `RegExp`

## Returns

[`SerializedNode`](../../index/interfaces/SerializedNode.md)[]
