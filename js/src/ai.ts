import { getHost } from "./host";

/**
 * On-device AI via Apple's Foundation Models framework — the ~3B-parameter
 * model behind Apple Intelligence. generateText(prompt) bridges to a native
 * LanguageModelSession; the Promise resolves with the generated text. Runs
 * entirely on device (no network), so it works on a standalone watch.
 *
 * Async like fetch: __host.generate(id, requestJson) starts a session;
 * Swift settles it on the main thread via __resolveGenerate/__rejectGenerate.
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
