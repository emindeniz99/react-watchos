import { invoke } from "./invoke";
import {
  type NativeEventHandler,
  registerNativeListener,
  type Unsubscribe,
} from "./nativeEvents";

/**
 * Audio playback (AVAudioPlayer over an AVAudioSession `.playback`): plays a
 * sound from an https URL — the watch downloads it, then routes to paired
 * Bluetooth audio, or the built-in speaker if none. For a short cue, a
 * mindfulness chime, a timer alert, etc. Distinct from `speak` (TTS) and
 * `playHaptic` (taptic). Completion fires on the push channel as
 * `audio.finished`.
 */
export const AUDIO_FINISHED_EVENT = "audio.finished";

export interface PlayAudioOptions {
  /** 0–1 playback volume. */
  volume?: number;
  /** Loop until stopAudio()/a new play; default false. */
  loop?: boolean;
}

/**
 * Downloads and plays the audio at `url`. Resolves once playback STARTS
 * (listen on {@link onAudioFinished} for the end); rejects on a download or
 * decode failure. Use https and keep clips small — the whole file is fetched
 * before playback.
 */
export function playAudio(
  url: string,
  options?: PlayAudioOptions,
): Promise<void> {
  return invoke("playAudio", { url, ...options });
}

/** Stops playback and deactivates the audio session. */
export function stopAudio(): Promise<void> {
  return invoke("stopAudio");
}

/** Fires when a clip finishes on its own (not on stopAudio). */
export function onAudioFinished(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(AUDIO_FINISHED_EVENT, handler);
}
