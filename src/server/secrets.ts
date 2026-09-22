import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

export type SecretResult =
  | { ok: true; value: string }
  | { ok: false; error: "missing_key" | "invalid_key" | "decrypt_failed" };

export function encryptSecret(value: string | null): SecretResult {
  if (value === null) return { ok: true, value: "" };
  const key = configuredKey();
  if (!key) return process.env.NODE_ENV === "production" ? { ok: false, error: "missing_key" } : { ok: true, value };
  if (key.length !== 32) return { ok: false, error: "invalid_key" };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ok: true, value: `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}` };
}

export function decryptSecret(value: string | null): SecretResult {
  if (!value) return { ok: true, value: "" };
  if (!value.startsWith(PREFIX)) return { ok: true, value };
  const key = configuredKey();
  if (!key) return { ok: false, error: "missing_key" };
  if (key.length !== 32) return { ok: false, error: "invalid_key" };
  const [ivEncoded, tagEncoded, ciphertextEncoded] = value.slice(PREFIX.length).split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) return { ok: false, error: "decrypt_failed" };
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivEncoded, "base64url"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    return { ok: true, value: Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8") };
  } catch {
    return { ok: false, error: "decrypt_failed" };
  }
}

export function secretsConfigured(): boolean {
  return configuredKey() !== null;
}

export function secretKeyMaterial(): Buffer | null {
  const key = configuredKey();
  return key ? Buffer.from(key) : null;
}

function configuredKey(): Buffer | null {
  const raw = process.env.GAUNTLET_SECRETS_KEY?.trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64url");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}
