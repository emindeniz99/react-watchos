import { invoke } from "./invoke";
import {
  type NativeEventHandler,
  registerNativeListener,
  type Unsubscribe,
} from "./nativeEvents";

/**
 * Speech synthesis (AVSpeechSynthesizer): speak text aloud through the watch
 * speaker / paired audio. Completion (or interruption by a new utterance /
 * stopSpeaking) fires on the push channel as `speech.finished`.
 */
export const SPEECH_FINISHED_EVENT = "speech.finished";

export interface SpeakOptions {
  /** 0–1; ~0.5 is the natural default. */
  rate?: number;
  /** 0.5–2.0 pitch multiplier. */
  pitch?: number;
  /** BCP-47 voice language, e.g. "en-US". Defaults to the system voice. */
  language?: string;
  /** 0–1 volume. */
  volume?: number;
}

/** Speaks `text`. Resolves once the utterance is enqueued (not when it
 *  finishes — listen on {@link onSpeechFinished} for that). */
export function speak(text: string, options?: SpeakOptions): Promise<void> {
  return invoke("speak", { text, ...options });
}

/** Stops any current + queued speech immediately. */
export function stopSpeaking(): Promise<void> {
  return invoke("stopSpeaking");
}

/** Fires when an utterance finishes or is cancelled (`{ text }`). */
export function onSpeechFinished(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(SPEECH_FINISHED_EVENT, handler);
}
