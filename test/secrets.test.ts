import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/server/secrets";

const original = process.env.GAUNTLET_SECRETS_KEY;

afterEach(() => {
  if (original === undefined) delete process.env.GAUNTLET_SECRETS_KEY;
  else process.env.GAUNTLET_SECRETS_KEY = original;
});
describe("secret envelope", () => {
  it("encrypts and decrypts without storing plaintext", () => {
    process.env.GAUNTLET_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64url");
    const encrypted = encryptSecret("provider-secret");
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;
    expect(encrypted.value).toMatch(/^enc:v1:/);
    expect(encrypted.value).not.toContain("provider-secret");
    expect(decryptSecret(encrypted.value)).toEqual({ ok: true, value: "provider-secret" });
  });

  it("rejects encrypted material when the key is missing", () => {
    process.env.GAUNTLET_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64url");
    const encrypted = encryptSecret("provider-secret");
    expect(encrypted.ok).toBe(true);
    delete process.env.GAUNTLET_SECRETS_KEY;
    expect(decryptSecret(encrypted.ok ? encrypted.value : "")).toEqual({ ok: false, error: "missing_key" });
  });
});
