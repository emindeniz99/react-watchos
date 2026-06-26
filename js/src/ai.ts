import { getHost } from "./host";
import { invoke } from "./invoke";

/**
 * On-device AI via Apple's Foundation Models framework — the ~3B-parameter
 * model behind Apple Intelligence. generateText(prompt) bridges to a native
 * LanguageModelSession; the Promise resolves with the generated text. Runs
 * entirely on device (no network), so it works on a standalone watch.
 *
 * Async like fetch: __host.generate(id, requestJson) starts a session;
 * Swift settles it on the main thread via __resolveGenerate/__rejectGenerate.
 *
 * Requires watchOS 27+ (Foundation Models reached the watch at 27.0); on older
 * versions the native side rejects with "on-device AI unavailable", so guard
 * calls or handle the rejection.
 */
const pending = new Map<
  number,
  { resolve: (text: string) => void; reject: (error: unknown) => void }
>();
let nextId = 1;

const g = globalThis as Record<string, unknown>;
g.__resolveGenerate = (id: number, text: string) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  p.resolve(text);
};
g.__rejectGenerate = (id: number, message: string) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  p.reject(new Error(message));
};

export interface GenerateOptions {
  /** 0–1; higher = more creative. */
  temperature?: number;
  maxTokens?: number;
  /** Optional system instructions for the session. */
  instructions?: string;
}

/**
 * Whether on-device AI can actually run on this watch right now (CX-002) —
 * a runtime check, distinct from whether the build exposes the `ai` capability.
 * It can be false even on watchOS 27+ (the model isn't downloaded, Apple
 * Intelligence is off, or the device isn't eligible). Use it to show/hide an AI
 * feature without making a throwaway `generateText` call. Resolves `false`
 * (never rejects) when there's no AI-capable host (tests/Node/widget) or the OS
 * is below watchOS 27.
 */
export async function isOnDeviceAIAvailable(): Promise<boolean> {
  try {
    return (await invoke<boolean>("aiAvailability")) === true;
  } catch {
    return false;
  }
}

/** Generates text with the on-device model. Rejects if AI is unavailable. */
export function generateText(
  prompt: string,
  options?: GenerateOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const host = getHost();
    if (!host?.generate) {
      reject(new Error("on-device AI unavailable"));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    host.generate(id, JSON.stringify({ prompt, ...options }));
  });
}
