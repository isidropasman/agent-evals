import { createGauntletClient } from "../../src/sdk/client";

const client = createGauntletClient({
  baseUrl: process.env.GAUNTLET_URL ?? "http://localhost:3000",
  apiKey: process.env.GAUNTLET_API_KEY ?? "",
});

const registered = await client.registerAgent({
  name: "Support agent",
  externalId: "support-staging",
  source: "sdk",
});

if (!registered.ok) throw new Error(registered.error.message);

const trace = await client.ingestTrace({
  traceId: "trace-001",
  eventId: "trace-001-turn-001",
  agentId: registered.value.id,
  deployment: "staging",
  version: process.env.GIT_SHA ?? "local",
  kind: "turn",
  input: { message: "Where is my order?" },
  output: { message: "I can look that up." },
  latencyMs: 842,
  status: "ok",
  occurredAt: Date.now(),
});

if (!trace.ok) throw new Error(trace.error.message);
process.stdout.write(`Trace ${trace.value.traceId} sent\n`);
