import { getSetting, setSetting } from "./db";

export type KeyProvider = "anthropic" | "openai";

const ENV_VAR: Record<KeyProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export interface KeyStatus {
  configured: boolean;
  /** Where the key in effect came from — env wins, so a shell export always
   * overrides whatever was saved through the UI. */
  source: "env" | "stored" | null;
  masked: string | null;
}

/**
 * Keys can come from the environment (the developer path) or from the local
 * settings table (the "someone who isn't going to export a shell variable"
 * path). Both resolve here so no call site has to know which one was used.
 *
 * ponytail: the stored key sits in plaintext in the local SQLite file, same
 * trust level as a .env file on the same disk. Encrypting it needs a secret
 * that would itself live next to the DB, so it buys nothing until this runs
 * multi-tenant — at which point keys belong in a real secret store, not here.
 */
export function resolveKey(provider: KeyProvider): string | null {
  const fromEnv = process.env[ENV_VAR[provider]];
  if (fromEnv) return fromEnv;
  return getSetting(`apikey.${provider}`);
}

export function keyStatus(provider: KeyProvider): KeyStatus {
  const fromEnv = process.env[ENV_VAR[provider]];
  if (fromEnv) return { configured: true, source: "env", masked: mask(fromEnv) };
  const stored = getSetting(`apikey.${provider}`);
  if (stored) return { configured: true, source: "stored", masked: mask(stored) };
  return { configured: false, source: null, masked: null };
}

export function storeKey(provider: KeyProvider, value: string | null): void {
  setSetting(`apikey.${provider}`, value);
}

/** Enough to recognise which key it is, not enough to use it. */
function mask(value: string): string {
  if (value.length <= 10) return "•".repeat(value.length);
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
