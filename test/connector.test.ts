import { afterEach, describe, expect, it } from "vitest";
import { sendToAgent } from "@/engine/connector";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("agent connector error redaction", () => {
  it("does not persist endpoint URLs or response bodies in errors", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ secret: "do-not-leak" }), { status: 502 })) as typeof fetch;
    const result = await sendToAgent(
      { endpointUrl: "http://127.0.0.1:43123/chat", protocol: "openai", authType: "none" },
      [{ role: "user", content: "hello" }],
      "session",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("Agent returned HTTP 502");
      expect(result.error.message).not.toContain("do-not-leak");
      expect(result.error.message).not.toContain("43123");
    }
  });
});
