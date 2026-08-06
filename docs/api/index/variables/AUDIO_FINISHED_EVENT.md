[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AUDIO\_FINISHED\_EVENT

# Variable: AUDIO\_FINISHED\_EVENT

> `const` **AUDIO\_FINISHED\_EVENT**: `"audio.finished"` = `"audio.finished"`

Defined in: [js/src/audio.ts:16](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/audio.ts#L16)

Audio playback (AVAudioPlayer over an AVAudioSession `.playback`): plays a
sound from an https URL — the watch downloads it, then routes to paired
Bluetooth audio, or the built-in speaker if none. For a short cue, a
mindfulness chime, a timer alert, etc. Distinct from `speak` (TTS) and
`playHaptic` (taptic). Completion fires on the push channel as
`audio.finished`.
