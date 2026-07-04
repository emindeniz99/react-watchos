import { invoke } from "./invoke";

/**
 * Keychain secure storage (Security framework) — for tokens and secrets that
 * must NOT live in `Storage` (App Group UserDefaults is not encrypted at rest
 * the way the Keychain is). Items are scoped to this app, `whenUnlocked`
 * accessibility. Values are strings (base64 your binary).
 *
 * Async because the Keychain call crosses the invoke channel; it's cheap.
 */
export const Keychain = {
  /** Stores (or replaces) a secret under `key`. */
  set(key: string, value: string): Promise<void> {
    return invoke("keychainSet", { key, value });
  },
  /** Returns the stored secret, or null when absent. */
  get(key: string): Promise<string | null> {
    return invoke<string | null>("keychainGet", { key });
  },
  /** Removes the secret (no-op when absent). */
  delete(key: string): Promise<void> {
    return invoke("keychainDelete", { key });
  },
};
