[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / isOnDeviceAIAvailable

# Function: isOnDeviceAIAvailable()

> **isOnDeviceAIAvailable**(): `Promise`\<`boolean`\>

Defined in: [js/src/ai.ts:68](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/ai.ts#L68)

Whether on-device AI can actually run on this watch right now (CX-002) —
a runtime check, distinct from whether the build exposes the `ai` capability.
It can be false even on watchOS 27+ (the model isn't downloaded, Apple
Intelligence is off, or the device isn't eligible). Use it to show/hide an AI
feature without making a throwaway `generateText` call. Resolves `false`
(never rejects) when there's no AI-capable host (tests/Node/widget) or the OS
is below watchOS 27.

## Returns

`Promise`\<`boolean`\>
