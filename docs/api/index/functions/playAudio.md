[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / playAudio

# Function: playAudio()

> **playAudio**(`url`, `options?`): `Promise`\<`void`\>

Defined in: [js/src/audio.ts:31](https://github.com/emindeniz99/react-watchos/blob/main/js/src/audio.ts#L31)

Downloads and plays the audio at `url`. Resolves once playback STARTS
(listen on [onAudioFinished](onAudioFinished.md) for the end); rejects on a download or
decode failure. Use https and keep clips small — the whole file is fetched
before playback.

## Parameters

### url

`string`

### options?

[`PlayAudioOptions`](../interfaces/PlayAudioOptions.md)

## Returns

`Promise`\<`void`\>
