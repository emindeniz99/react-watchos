[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / speak

# Function: speak()

> **speak**(`text`, `options?`): `Promise`\<`void`\>

Defined in: [js/src/speech.ts:28](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/speech.ts#L28)

Speaks `text`. Resolves once the utterance is enqueued (not when it
 finishes — listen on [onSpeechFinished](onSpeechFinished.md) for that).

## Parameters

### text

`string`

### options?

[`SpeakOptions`](../interfaces/SpeakOptions.md)

## Returns

`Promise`\<`void`\>
