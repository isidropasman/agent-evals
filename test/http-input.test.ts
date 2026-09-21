import { describe, expect, it } from "vitest";
import { parseAgentRegistration, parseDatasetVersionInput, parseRegressionGateInput, parseTraceEnvelope } from "@/server/http-input";

describe("machine input contracts", () => {
  it("accepts an observed agent without endpoint credentials", () => {
    const result = parseAgentRegistration({
      name: "Support agent",
      source: "sdk",
      externalId: "support-staging",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        id: undefined,
        name: "Support agent",
        clientName: undefined,
        endpointUrl: undefined,
        protocol: undefined,
        systemPrompt: undefined,
        agentFamily: undefined,
        mode: undefined,
        source: "sdk",
        externalId: "support-staging",
      },
    });
  });

  it("rejects malformed trace metadata and accepts arbitrary payloads", () => {
    expect(parseTraceEnvelope({
      traceId: "trace",
      eventId: "event",
      agentId: "agent",
      kind: "turn",
      occurredAt: Date.now(),
      input: { nested: true },
      metadata: { invalid: 4 },
    })).toEqual({ ok: false, error: "metadata debe ser un objeto de strings" });
    expect(parseTraceEnvelope({
      traceId: "trace",
      eventId: "event",
      agentId: "agent",
      kind: "turn",
      occurredAt: Date.now(),
      input: { nested: true },
      metadata: { environment: "test" },
    }).ok).toBe(true);
  });

  it("normalizes gate case IDs and rejects empty assertions or undefined dataset inputs", () => {
    expect(parseRegressionGateInput({ caseIds: [" case-1 "] })).toMatchObject({ ok: true, value: { caseIds: ["case-1"] } });
    expect(parseTraceEnvelope({ traceId: "t", eventId: "e", agentId: "a", kind: "assertion", occurredAt: 1, assertion: { name: " ", passed: true } })).toEqual({ ok: false, error: "assertion debe tener name y passed" });
    expect(parseDatasetVersionInput({ name: "d", version: "v1", items: [{ input: undefined }] })).toEqual({ ok: false, error: "cada item debe tener input" });
  });
});
