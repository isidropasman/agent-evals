import { afterEach, describe, expect, it } from "vitest";
import { assertAllowedUrl } from "@/engine/ssrf";

const prevEnv = process.env.GAUNTLET_ALLOW_LOCAL_AGENTS;
const prevNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.GAUNTLET_ALLOW_LOCAL_AGENTS = prevEnv;
  (process.env as Record<string, string>).NODE_ENV = prevNodeEnv ?? "test";
});

function lockdown() {
  process.env.GAUNTLET_ALLOW_LOCAL_AGENTS = "0";
  (process.env as Record<string, string>).NODE_ENV = "production";
}

describe("assertAllowedUrl SSRF guard", () => {
  it("rejects non-http schemes", async () => {
    const r = await assertAllowedUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
  });

  it("rejects cloud metadata IP in lockdown", async () => {
    lockdown();
    const r = await assertAllowedUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
  });

  it("rejects loopback literal in lockdown", async () => {
    lockdown();
    const r = await assertAllowedUrl("https://127.0.0.1/x");
    expect(r.ok).toBe(false);
  });

  it("rejects private 10/8 in lockdown", async () => {
    lockdown();
    const r = await assertAllowedUrl("https://10.1.2.3/x");
    expect(r.ok).toBe(false);
  });

  it("rejects private 192.168/16 in lockdown", async () => {
    lockdown();
    const r = await assertAllowedUrl("https://192.168.0.5/x");
    expect(r.ok).toBe(false);
  });

  it("rejects IPv6 loopback in lockdown", async () => {
    lockdown();
    const r = await assertAllowedUrl("https://[::1]/x");
    expect(r.ok).toBe(false);
  });

  it("rejects http (non-https) in lockdown", async () => {
    lockdown();
    const r = await assertAllowedUrl("http://example.com/x");
    expect(r.ok).toBe(false);
  });

  it("allows loopback when local agents are enabled", async () => {
    process.env.GAUNTLET_ALLOW_LOCAL_AGENTS = "1";
    const r = await assertAllowedUrl("http://127.0.0.1:3000/api/demo-agent");
    expect(r.ok).toBe(true);
  });

  it("BLOCKS cloud metadata even when local agents are enabled", async () => {
    process.env.GAUNTLET_ALLOW_LOCAL_AGENTS = "1";
    const r = await assertAllowedUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
  });

  it("allows loopback but still blocks metadata with the flag on", async () => {
    process.env.GAUNTLET_ALLOW_LOCAL_AGENTS = "1";
    const loop = await assertAllowedUrl("http://10.0.0.5/x");
    expect(loop.ok).toBe(true); // private LAN allowed under the flag
    const meta = await assertAllowedUrl("http://169.254.169.254/x");
    expect(meta.ok).toBe(false); // metadata never
  });

  it("allows a public HTTPS host in lockdown", async () => {
    lockdown();
    const r = await assertAllowedUrl("https://1.1.1.1/x");
    expect(r.ok).toBe(true);
  });
});
