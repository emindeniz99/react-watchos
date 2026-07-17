[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / defineMessages

# Function: defineMessages()

> **defineMessages**\<`T`\>(): [`TypedMessages`](../interfaces/TypedMessages.md)\<`T`\>

Defined in: [js/src/connectivity.ts:118](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L118)

Builds a typed wrapper over [sendToPhone](sendToPhone.md)/[onPhoneMessage](onPhoneMessage.md) for one
message contract (DX-6), turning "wire the JSON yourself" into "define once,
type-checked on both sides". Messages travel as `{ type, payload }`; `on`
dispatches by `type` and hands the handler the typed payload.

    const m = defineMessages<{ togglePlay: { on: boolean } }>();
    m.on("togglePlay", ({ on }) => setPlaying(on)); // on: boolean
    await m.send("togglePlay", { on: true });

## Type Parameters

### T

`T` *extends* [`MessageContract`](../type-aliases/MessageContract.md)

## Returns

[`TypedMessages`](../interfaces/TypedMessages.md)\<`T`\>
