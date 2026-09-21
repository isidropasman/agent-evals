export interface SdkAgent {
  id: string;
  name: string;
  workspaceId: string;
  source: "manual" | "sdk" | "mcp" | "ci";
  externalId: string | null;
  canRun: boolean;
}

export interface SdkAgentRegistration {
  name: string;
  externalId?: string;
  endpointUrl?: string;
  systemPrompt?: string;
  source?: "sdk" | "ci";
}

export interface SdkTraceEnvelope {
  traceId: string;
  eventId: string;
  agentId: string;
  deployment?: string;
  version?: string;
  parentId?: string;
  kind: "run" | "turn" | "tool_call" | "tool_result" | "assertion";
  input?: unknown;
  output?: unknown;
  toolName?: string;
  toolArguments?: unknown;
  toolResult?: unknown;
  latencyMs?: number;
  status?: "ok" | "error";
  assertion?: { name: string; passed: boolean; detail?: string };
  occurredAt: number;
  metadata?: Record<string, string>;
}

export interface TraceReceipt {
  inserted: boolean;
  traceId: string;
}

export interface TraceBatchReceipt {
  accepted: string[];
  duplicates: string[];
  rejected: Array<{ index: number; error: string }>;
}

export interface SdkDatasetItem {
  input: unknown;
  expectedOutput?: unknown;
  evaluator?: { type: "model" } | { type: "contains"; value: string; caseSensitive?: boolean } | { type: "regex"; pattern: string; flags?: string } | { type: "exact_json"; value: unknown };
  metadata?: Record<string, string>;
}

export interface SdkTraceSummary {
  traceId: string;
  eventId: string;
  agentId: string;
  deployment: string | null;
  version: string | null;
  kind: SdkTraceEnvelope["kind"];
  toolName: string | null;
  latencyMs: number | null;
  status: "ok" | "error" | null;
  assertion: { name: string; passed: boolean; detail?: string } | null;
  occurredAt: number;
  metadata: Record<string, string> | null;
}

export interface SdkRunSummary {
  id: string;
  agentId: string | null;
  agentName: string;
  status: "queued" | "running" | "done" | "error";
  score: number | null;
  certified: boolean | null;
  suite: "balanced" | "safety" | "reliability" | "tools" | null;
  createdAt: number;
}

export interface SdkRegressionCaseSummary {
  id: string;
  workspaceId: string;
  agentId: string;
  sourceTraceId: string;
  name: string;
  assertionName: string;
  assertionDetail: string | null;
  expectedPass: boolean;
  lastStatus: "pass" | "fail" | "error" | null;
  lastPassed: boolean | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SdkRegressionReplay {
  passed: boolean;
  latencyMs: number;
  verdict: { pass: boolean; failedCriteria: string[]; rationale: string };
}

export interface SdkGateCaseResult {
  caseId: string;
  agentId: string;
  status: "pass" | "fail" | "error";
  passed: boolean | null;
  baselineStatus: "pass" | "fail" | "error" | null;
  regression: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface SdkGateReport {
  id: string;
  workspaceId: string;
  version: string;
  baselineVersion: string | null;
  status: "pass" | "fail" | "error";
  total: number;
  passed: number;
  failed: number;
  errors: number;
  regressions: number;
  createdAt: number;
  completedAt: number;
  cases: SdkGateCaseResult[];
}

export interface SdkGateSummary extends Omit<SdkGateReport, "cases" | "workspaceId" | "completedAt"> {
  completedAt: number | null;
}

export type ClientResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: "network" | "http" | "invalid_response"; message: string; status?: number } };

export interface GauntletClient {
  createKey(name: string): Promise<ClientResult<{ token: string; prefix: string }>>;
  registerAgent(input: SdkAgentRegistration): Promise<ClientResult<SdkAgent>>;
  ingestTrace(envelope: SdkTraceEnvelope): Promise<ClientResult<TraceReceipt>>;
  ingestTraces(traces: SdkTraceEnvelope[]): Promise<ClientResult<TraceBatchReceipt>>;
  createDataset(input: { name: string; version: string; items: SdkDatasetItem[] }): Promise<ClientResult<{ dataset: { id: string; name: string; version: string; checksum: string; itemCount: number }; created: boolean }>>;
  listDatasets(): Promise<ClientResult<{ datasets: Array<{ id: string; name: string; version: string; checksum: string; itemCount: number }> }>>;
  listAgents(): Promise<ClientResult<{ agents: SdkAgent[] }>>;
  listTraces(input?: { agentId?: string; limit?: number }): Promise<ClientResult<{ traces: SdkTraceSummary[] }>>;
  listRuns(input?: { agentId?: string }): Promise<ClientResult<{ runs: SdkRunSummary[] }>>;
  listCases(): Promise<ClientResult<{ cases: SdkRegressionCaseSummary[] }>>;
  promoteTrace(input: { agentId: string; traceId: string; name?: string }): Promise<ClientResult<SdkRegressionCaseSummary>>;
  replayCase(caseId: string): Promise<ClientResult<{ case: SdkRegressionCaseSummary; replay: SdkRegressionReplay }>>;
  runGate(input?: { caseIds?: string[]; suiteId?: string; version?: string; concurrency?: number }): Promise<ClientResult<SdkGateReport>>;
  listGates(): Promise<ClientResult<{ gates: SdkGateSummary[] }>>;
}

export function createGauntletClient(input: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): GauntletClient {
  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    createKey: (name) => request(fetchImpl, `${baseUrl}/api/v1/keys`, input.apiKey, { name }),
    registerAgent: (registration) => request(fetchImpl, `${baseUrl}/api/v1/agents`, input.apiKey, registration),
    ingestTrace: (envelope) => request(fetchImpl, `${baseUrl}/api/v1/traces`, input.apiKey, envelope),
    ingestTraces: (traces) => request(fetchImpl, `${baseUrl}/api/v1/traces/batch`, input.apiKey, { traces }),
    createDataset: (dataset) => request(fetchImpl, `${baseUrl}/api/v1/datasets`, input.apiKey, dataset, null),
    listDatasets: () => get(fetchImpl, `${baseUrl}/api/v1/datasets`, input.apiKey),
    listAgents: () => get(fetchImpl, `${baseUrl}/api/v1/agents`, input.apiKey),
    listTraces: (query) => get(fetchImpl, `${baseUrl}/api/v1/traces${queryString(query)}`, input.apiKey),
    listRuns: (query) => get(fetchImpl, `${baseUrl}/api/v1/runs${queryString(query)}`, input.apiKey),
    listCases: () => get(fetchImpl, `${baseUrl}/api/v1/cases`, input.apiKey),
    promoteTrace: (promotion) => request(fetchImpl, `${baseUrl}/api/v1/cases/from-trace`, input.apiKey, promotion, "case"),
    replayCase: (caseId) => request(fetchImpl, `${baseUrl}/api/v1/cases/${encodeURIComponent(caseId)}/replay`, input.apiKey, {}, null),
    runGate: (gateInput) => runGateRequest(fetchImpl, `${baseUrl}/api/v1/gates`, input.apiKey, gateInput ?? {}),
    listGates: () => get(fetchImpl, `${baseUrl}/api/v1/gates`, input.apiKey),
  };
}

async function runGateRequest(fetchImpl: typeof fetch, url: string, apiKey: string, body: unknown): Promise<ClientResult<SdkGateReport>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
  } catch (error: unknown) {
    return { ok: false, error: { kind: "network", message: error instanceof Error ? error.message : "network error" } };
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok && response.status !== 202) return { ok: false, error: { kind: "http", message: errorMessage(json), status: response.status } };
  if (response.status !== 202) return isRecord(json) ? { ok: true, value: json as unknown as SdkGateReport } : { ok: false, error: { kind: "invalid_response", message: "server returned an invalid gate" } };
  if (!isRecord(json) || typeof json.gateRunId !== "string") return { ok: false, error: { kind: "invalid_response", message: "async gate response is invalid" } };
  return pollGate(fetchImpl, new URL(`/api/v1/gates/${encodeURIComponent(json.gateRunId)}`, url).toString(), apiKey);
}

async function pollGate(fetchImpl: typeof fetch, url: string, apiKey: string): Promise<ClientResult<SdkGateReport>> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    let response: Response;
    try {
      response = await fetchImpl(url, { method: "GET", headers: { authorization: `Bearer ${apiKey}` } });
    } catch (error: unknown) {
      return { ok: false, error: { kind: "network", message: error instanceof Error ? error.message : "network error" } };
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, error: { kind: "http", message: errorMessage(json), status: response.status } };
    if (!isRecord(json) || !isRecord(json.gate)) return { ok: false, error: { kind: "invalid_response", message: "async gate detail is invalid" } };
    const gate = json.gate as unknown as { status: "running" | "pass" | "fail" | "error" } & Omit<SdkGateReport, "status">;
    if (gate.status === "running") continue;
    const completedStatus = gate.status;
    return { ok: true, value: { ...gate, status: completedStatus, cases: Array.isArray(json.cases) ? json.cases as SdkGateCaseResult[] : [] } };
  }
  return { ok: false, error: { kind: "network", message: "async gate polling timed out" } };
}

async function get<T>(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
): Promise<ClientResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
    });
  } catch (error: unknown) {
    return { ok: false, error: { kind: "network", message: error instanceof Error ? error.message : "network error" } };
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: { kind: "http", message: errorMessage(json), status: response.status } };
  if (!isRecord(json)) return { ok: false, error: { kind: "invalid_response", message: "server returned an invalid response" } };
  return { ok: true, value: json as T };
}

async function request<T>(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
  body: unknown,
  unwrap: "auto" | "agent" | "key" | "case" | null = "auto",
): Promise<ClientResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (error: unknown) {
    return { ok: false, error: { kind: "network", message: error instanceof Error ? error.message : "network error" } };
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: { kind: "http", message: errorMessage(json), status: response.status } };
  if (!isRecord(json)) return { ok: false, error: { kind: "invalid_response", message: "server returned an invalid response" } };
  const value = unwrap === null ? json : unwrap === "agent" ? json.agent : unwrap === "key" ? json.key : unwrap === "case" ? json.case : "agent" in json ? json.agent : "key" in json ? json.key : json;
  return { ok: true, value: value as T };
}

function errorMessage(value: unknown): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : "request failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function queryString(input: Record<string, string | number | undefined> | undefined): string {
  if (!input) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
