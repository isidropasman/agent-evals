import { randomUUID } from "node:crypto";
import type {
  AgentRow,
  RegressionCaseRecord,
  RegressionCaseStatus,
  RegressionGateCaseResultRecord,
  RegressionGateRunRecord,
  RegressionGateStatus,
  RunRow,
  TraceRecord,
  TraceStatsRecord,
  WorkspaceKeyRecord,
  WorkspaceRecord,
} from "./db";
import { queryShared, type SharedRow } from "./shared-db";
import { decryptSecret, encryptSecret } from "./secrets";
import type { EvaluatorDefinition } from "@/engine/evaluators";
import type { RunProgress, RunReport } from "@/engine/types";

export type SharedStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export async function sharedGetWorkspace(id: string): Promise<WorkspaceRecord | null> {
  const result = await queryShared("SELECT id, name, created_at FROM workspaces WHERE id = $1", [id]);
  if (!result.ok) return null;
  const row = result.rows[0];
  return row ? workspaceFromRow(row) : null;
}

export async function sharedInsertWorkspace(workspace: WorkspaceRecord): Promise<SharedStoreResult<void>> {
  const result = await queryShared(
    "INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [workspace.id, workspace.name, workspace.createdAt],
  );
  return result.ok ? { ok: true, value: undefined } : { ok: false, error: result.error };
}

export async function sharedGetWorkspaceKeyByPrefix(prefix: string): Promise<WorkspaceKeyRecord | null> {
  const result = await queryShared(
    "SELECT id, workspace_id, name, prefix, token_hash, role, created_at FROM workspace_keys WHERE prefix = $1",
    [prefix],
  );
  if (!result.ok) return null;
  const row = result.rows[0];
  return row ? workspaceKeyFromRow(row) : null;
}

export async function sharedInsertWorkspaceKey(key: WorkspaceKeyRecord): Promise<SharedStoreResult<void>> {
  const result = await queryShared(
    `INSERT INTO workspace_keys (id, workspace_id, name, prefix, token_hash, role, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [key.id, key.workspaceId, key.name, key.prefix, key.tokenHash, key.role, key.createdAt],
  );
  return result.ok ? { ok: true, value: undefined } : { ok: false, error: result.error };
}

export async function sharedGetAgent(id: string, workspaceId?: string): Promise<AgentRow | null> {
  const result = workspaceId
    ? await queryShared("SELECT * FROM agents WHERE id = $1 AND workspace_id = $2", [id, workspaceId])
    : await queryShared("SELECT * FROM agents WHERE id = $1", [id]);
  if (!result.ok) return null;
  const row = result.rows[0];
  return row ? agentFromRow(row) : null;
}

export async function sharedGetAgentByExternalId(workspaceId: string, externalId: string): Promise<AgentRow | null> {
  const result = await queryShared("SELECT * FROM agents WHERE workspace_id = $1 AND external_id = $2", [workspaceId, externalId]);
  if (!result.ok) return null;
  const row = result.rows[0];
  return row ? agentFromRow(row) : null;
}

export async function sharedListAgents(workspaceId: string): Promise<AgentRow[]> {
  const result = await queryShared("SELECT * FROM agents WHERE workspace_id = $1 ORDER BY active DESC, updated_at DESC", [workspaceId]);
  return result.ok ? result.rows.map(agentFromRow) : [];
}

export async function sharedInsertAgent(agent: AgentRow): Promise<SharedStoreResult<boolean>> {
  const encrypted = encryptSecret(agent.authToken);
  if (!encrypted.ok) return encrypted;
  const result = await queryShared(
    `INSERT INTO agents
      (id, workspace_id, name, client_name, endpoint_url, protocol, auth_type, auth_token,
       auth_header_name, system_prompt, agent_family, mode, tools_json, active, source,
       external_id, last_trace_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     ON CONFLICT DO NOTHING RETURNING id`,
    [agent.id, agent.workspaceId, agent.name, agent.clientName, agent.endpointUrl, agent.protocol,
      agent.authType, encrypted.value || null, agent.authHeaderName, agent.systemPrompt,
      agent.agentFamily, agent.mode, JSON.stringify(agent.tools), agent.active, agent.source,
      agent.externalId, agent.lastTraceAt, agent.createdAt, agent.updatedAt],
  );
  return result.ok ? { ok: true, value: result.rows.length === 1 } : { ok: false, error: result.error };
}

export async function sharedInsertTrace(trace: TraceRecord): Promise<SharedStoreResult<boolean>> {
  const result = await queryShared(
    `INSERT INTO traces
      (workspace_id, event_id, trace_id, agent_id, deployment, version, parent_id, kind,
       input_json, output_json, tool_name, tool_arguments_json, tool_result_json, latency_ms,
       status, assertion_json, occurred_at, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (workspace_id, event_id) DO NOTHING
     RETURNING event_id`,
    [trace.workspaceId, trace.eventId, trace.traceId, trace.agentId, trace.deployment,
      trace.version, trace.parentId, trace.kind, json(trace.input), json(trace.output),
      trace.toolName, json(trace.toolArguments), json(trace.toolResult), trace.latencyMs,
      trace.status, json(trace.assertion), trace.occurredAt, json(trace.metadata)],
  );
  if (!result.ok) return { ok: false, error: result.error };
  if (result.rows.length > 0) {
    await queryShared("UPDATE agents SET last_trace_at = $1, updated_at = $2 WHERE id = $3 AND workspace_id = $4", [trace.occurredAt, Date.now(), trace.agentId, trace.workspaceId]);
  }
  return { ok: true, value: result.rows.length === 1 };
}

export async function sharedListTraces(workspaceId: string, limit: number, agentId?: string): Promise<TraceRecord[]> {
  const result = agentId
    ? await queryShared("SELECT * FROM traces WHERE workspace_id = $1 AND agent_id = $2 ORDER BY occurred_at DESC LIMIT $3", [workspaceId, agentId, limit])
    : await queryShared("SELECT * FROM traces WHERE workspace_id = $1 ORDER BY occurred_at DESC LIMIT $2", [workspaceId, limit]);
  return result.ok ? result.rows.map(traceFromRow) : [];
}

export async function sharedGetTrace(workspaceId: string, agentId: string, traceId: string): Promise<TraceRecord | null> {
  const result = await queryShared("SELECT * FROM traces WHERE workspace_id = $1 AND agent_id = $2 AND trace_id = $3 ORDER BY occurred_at DESC LIMIT 1", [workspaceId, agentId, traceId]);
  if (!result.ok) return null;
  const row = result.rows[0];
  return row ? traceFromRow(row) : null;
}

export async function sharedTraceStats(workspaceId: string, now = Date.now()): Promise<TraceStatsRecord> {
  const result = await queryShared(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN occurred_at >= $1 THEN 1 ELSE 0 END) AS last24h,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN kind = 'assertion' AND (assertion_json::jsonb ->> 'passed') = 'false' THEN 1 ELSE 0 END) AS failed_assertions,
      SUM(CASE WHEN kind = 'tool_call' THEN 1 ELSE 0 END) AS tool_calls
     FROM traces WHERE workspace_id = $2`,
    [now - 86_400_000, workspaceId],
  );
  const row = result.ok ? result.rows[0] : undefined;
  return {
    total: numberValue(row?.total),
    last24h: numberValue(row?.last24h),
    errors: numberValue(row?.errors),
    failedAssertions: numberValue(row?.failed_assertions),
    toolCalls: numberValue(row?.tool_calls),
  };
}

export async function sharedGetCase(workspaceId: string, id: string): Promise<RegressionCaseRecord | null> {
  const result = await queryShared("SELECT * FROM regression_cases WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
  if (!result.ok) return null;
  const row = result.rows[0];
  return row ? caseFromRow(row) : null;
}

export async function sharedGetCaseBySource(workspaceId: string, agentId: string, sourceTraceId: string): Promise<RegressionCaseRecord | null> {
  const result = await queryShared("SELECT * FROM regression_cases WHERE workspace_id = $1 AND agent_id = $2 AND source_trace_id = $3", [workspaceId, agentId, sourceTraceId]);
  if (!result.ok) return null;
  const row = result.rows[0];
  return row ? caseFromRow(row) : null;
}

export async function sharedListCases(workspaceId: string): Promise<RegressionCaseRecord[]> {
  const result = await sharedListCasesResult(workspaceId);
  return result.ok ? result.value : [];
}

export async function sharedListCasesResult(workspaceId: string): Promise<SharedStoreResult<RegressionCaseRecord[]>> {
  const result = await queryShared("SELECT * FROM regression_cases WHERE workspace_id = $1 ORDER BY updated_at DESC", [workspaceId]);
  return result.ok ? { ok: true, value: result.rows.map(caseFromRow) } : { ok: false, error: result.error };
}

export async function sharedInsertCase(input: RegressionCaseRecord): Promise<SharedStoreResult<boolean>> {
  const result = await queryShared(
    `INSERT INTO regression_cases
      (id, workspace_id, agent_id, source_trace_id, suite_id, name, input_json, assertion_name,
       assertion_detail, evaluator_json, expected_pass, last_status, last_passed, last_latency_ms, last_error,
       last_run_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (workspace_id, agent_id, source_trace_id) DO NOTHING
     RETURNING id`,
    [input.id, input.workspaceId, input.agentId, input.sourceTraceId, input.suiteId, input.name, input.inputText,
      input.assertionName, input.assertionDetail, json(input.evaluator), input.expectedPass, input.lastStatus,
      input.lastPassed, input.lastLatencyMs, input.lastError, input.lastRunAt, input.createdAt, input.updatedAt],
  );
  return result.ok ? { ok: true, value: result.rows.length === 1 } : { ok: false, error: result.error };
}

export async function sharedUpdateCaseReplay(workspaceId: string, id: string, input: { status: RegressionCaseStatus; passed: boolean | null; latencyMs: number | null; error: string | null; runAt: number }): Promise<boolean> {
  const result = await queryShared(
    `UPDATE regression_cases SET last_status = $1, last_passed = $2, last_latency_ms = $3,
      last_error = $4, last_run_at = $5, updated_at = $5 WHERE workspace_id = $6 AND id = $7 RETURNING id`,
    [input.status, input.passed, input.latencyMs, input.error, input.runAt, workspaceId, id],
  );
  return result.ok && result.rows.length === 1;
}

export async function sharedStartGate(workspaceId: string, version: string): Promise<SharedStoreResult<{ run: RegressionGateRunRecord; baselineCases: Map<string, RegressionGateCaseResultRecord> }>> {
  const baselineResult = await queryShared("SELECT * FROM regression_gate_runs WHERE workspace_id = $1 AND status IN ('pass', 'fail', 'error') ORDER BY completed_at DESC NULLS LAST, created_at DESC LIMIT 1", [workspaceId]);
  if (!baselineResult.ok) return { ok: false, error: baselineResult.error };
  const baselineRow = baselineResult.rows[0];
  const baseline = baselineRow ? gateFromRow(baselineRow) : null;
  const baselineResults = baseline
    ? await queryShared("SELECT * FROM regression_gate_case_results WHERE workspace_id = $1 AND gate_run_id = $2", [workspaceId, baseline.id])
    : { ok: true as const, rows: [] as SharedRow[] };
  if (!baselineResults.ok) return { ok: false, error: baselineResults.error };
  const run: RegressionGateRunRecord = {
    id: randomUUID(), workspaceId, version, baselineVersion: baseline?.version ?? null,
    status: "running", total: 0, passed: 0, failed: 0, errors: 0, regressions: 0,
    createdAt: Date.now(), completedAt: null,
  };
  const inserted = await queryShared(
    `INSERT INTO regression_gate_runs (id, workspace_id, version, baseline_version, status, total, passed, failed, errors, regressions, created_at)
     VALUES ($1, $2, $3, $4, 'running', 0, 0, 0, 0, 0, $5)`,
    [run.id, workspaceId, version, run.baselineVersion, run.createdAt],
  );
  if (!inserted.ok) return { ok: false, error: inserted.error };
  return { ok: true, value: { run, baselineCases: new Map(baselineResults.rows.map((row) => { const value = gateCaseFromRow(row); return [value.caseId, value]; })) } };
}

export async function sharedInsertGateCaseResult(input: RegressionGateCaseResultRecord): Promise<SharedStoreResult<void>> {
  const result = await queryShared(
    `INSERT INTO regression_gate_case_results
      (gate_run_id, workspace_id, case_id, agent_id, status, passed, baseline_status, regression, latency_ms, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (gate_run_id, case_id) DO NOTHING`,
    [input.gateRunId, input.workspaceId, input.caseId, input.agentId, input.status, input.passed,
      input.baselineStatus, input.regression, input.latencyMs, input.error, input.createdAt],
  );
  return result.ok ? { ok: true, value: undefined } : { ok: false, error: result.error };
}

export async function sharedCompleteGate(workspaceId: string, id: string, input: Pick<RegressionGateRunRecord, "status" | "total" | "passed" | "failed" | "errors" | "regressions" | "completedAt">): Promise<boolean> {
  const result = await queryShared(
    `UPDATE regression_gate_runs SET status = $1, total = $2, passed = $3, failed = $4, errors = $5, regressions = $6, completed_at = $7
     WHERE workspace_id = $8 AND id = $9 AND status = 'running' RETURNING id`,
    [input.status, input.total, input.passed, input.failed, input.errors, input.regressions, input.completedAt, workspaceId, id],
  );
  return result.ok && result.rows.length === 1;
}

export async function sharedListGates(workspaceId: string, limit = 20): Promise<RegressionGateRunRecord[]> {
  const result = await queryShared("SELECT * FROM regression_gate_runs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2", [workspaceId, Math.min(100, Math.max(1, Math.floor(limit)))]);
  return result.ok ? result.rows.map(gateFromRow) : [];
}

export async function sharedGetGate(workspaceId: string, id: string): Promise<RegressionGateRunRecord | null> {
  const result = await queryShared("SELECT * FROM regression_gate_runs WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
  if (!result.ok) return null;
  const row = result.rows[0];
  return row ? gateFromRow(row) : null;
}

export async function sharedGetPreviousCompletedGate(workspaceId: string, beforeCreatedAt: number): Promise<RegressionGateRunRecord | null> {
  const result = await queryShared("SELECT * FROM regression_gate_runs WHERE workspace_id = $1 AND status IN ('pass', 'fail', 'error') AND created_at < $2 ORDER BY completed_at DESC NULLS LAST, created_at DESC LIMIT 1", [workspaceId, beforeCreatedAt]);
  if (!result.ok) return null;
  const row = result.rows[0];
  return row ? gateFromRow(row) : null;
}

export async function sharedListGateCaseResults(workspaceId: string, gateRunId: string): Promise<RegressionGateCaseResultRecord[]> {
  const result = await sharedListGateCaseResultsResult(workspaceId, gateRunId);
  return result.ok ? result.value : [];
}

export async function sharedListGateCaseResultsResult(workspaceId: string, gateRunId: string): Promise<SharedStoreResult<RegressionGateCaseResultRecord[]>> {
  const result = await queryShared("SELECT * FROM regression_gate_case_results WHERE workspace_id = $1 AND gate_run_id = $2 ORDER BY case_id ASC", [workspaceId, gateRunId]);
  return result.ok ? { ok: true, value: result.rows.map(gateCaseFromRow) } : { ok: false, error: result.error };
}

export async function sharedListRuns(workspaceId: string): Promise<RunRow[]> {
  const result = await queryShared("SELECT * FROM runs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100", [workspaceId]);
  return result.ok ? result.rows.map(runFromRow) : [];
}

export async function sharedGetRun(workspaceId: string, id: string): Promise<RunRow | null> {
  const result = await queryShared("SELECT * FROM runs WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
  const row = result.ok ? result.rows[0] : undefined;
  return row ? runFromRow(row) : null;
}

export async function sharedInsertRun(input: { id: string; workspaceId: string; agentId?: string; agentName: string; clientName: string | null; endpointUrl: string; createdAt: number; status: "queued" | "running" }): Promise<boolean> {
  const result = await queryShared(
    `INSERT INTO runs (id, workspace_id, agent_id, agent_name, client_name, endpoint_url, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [input.id, input.workspaceId, input.agentId ?? null, input.agentName, input.clientName, input.endpointUrl, input.status, input.createdAt],
  );
  return result.ok && result.rows.length === 1;
}

export async function sharedMarkRunRunning(workspaceId: string, id: string): Promise<boolean> {
  const result = await queryShared("UPDATE runs SET status = 'running' WHERE workspace_id = $1 AND id = $2 AND status = 'queued' AND cancel_requested = false RETURNING id", [workspaceId, id]);
  return result.ok && result.rows.length === 1;
}

export async function sharedRequestRunCancellation(workspaceId: string, id: string): Promise<boolean> {
  const result = await queryShared("UPDATE runs SET cancel_requested = true WHERE workspace_id = $1 AND id = $2 AND status IN ('queued', 'running') AND cancel_requested = false RETURNING id", [workspaceId, id]);
  return result.ok && result.rows.length === 1;
}

export async function sharedIsRunCancellationRequested(workspaceId: string, id: string): Promise<boolean> {
  const result = await queryShared<{ cancel_requested: boolean }>("SELECT cancel_requested FROM runs WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
  return result.ok && result.rows[0]?.cancel_requested === true;
}

export async function sharedUpdateRunProgress(workspaceId: string, id: string, progress: RunProgress): Promise<boolean> {
  const result = await queryShared("UPDATE runs SET progress_json = $1 WHERE workspace_id = $2 AND id = $3", [json(progress), workspaceId, id]);
  return result.ok;
}

export async function sharedCompleteRun(workspaceId: string, id: string, report: RunReport): Promise<boolean> {
  const result = await queryShared("UPDATE runs SET status = 'done', report_json = $1 WHERE workspace_id = $2 AND id = $3 AND status IN ('running', 'queued') AND cancel_requested = false RETURNING id", [json(report), workspaceId, id]);
  return result.ok && result.rows.length === 1;
}

export async function sharedFailRun(workspaceId: string, id: string, error: string): Promise<boolean> {
  const result = await queryShared("UPDATE runs SET status = 'error', error = $1 WHERE workspace_id = $2 AND id = $3 AND status IN ('running', 'queued') RETURNING id", [error, workspaceId, id]);
  return result.ok && result.rows.length === 1;
}

export async function sharedAudit(input: { workspaceId: string; actorId: string | null; actorType: string; action: string; resourceType: string; resourceId: string | null; requestId: string | null; ipHash: string | null; metadata?: unknown }): Promise<void> {
  await queryShared(
    `INSERT INTO audit_events (id, workspace_id, actor_id, actor_type, action, resource_type, resource_id, request_id, ip_hash, metadata_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [randomUUID(), input.workspaceId, input.actorId, input.actorType, input.action, input.resourceType,
      input.resourceId, input.requestId, input.ipHash, json(input.metadata), Date.now()],
  );
}

function workspaceFromRow(row: SharedRow): WorkspaceRecord {
  return { id: stringValue(row.id), name: stringValue(row.name), createdAt: numberValue(row.created_at) };
}

function workspaceKeyFromRow(row: SharedRow): WorkspaceKeyRecord {
  return { id: stringValue(row.id), workspaceId: stringValue(row.workspace_id), name: stringValue(row.name), prefix: stringValue(row.prefix), tokenHash: stringValue(row.token_hash), role: roleValue(row.role), createdAt: numberValue(row.created_at) };
}

function agentFromRow(row: SharedRow): AgentRow {
  const decrypted = decryptSecret(nullableString(row.auth_token));
  return {
    id: stringValue(row.id), workspaceId: stringValue(row.workspace_id), name: stringValue(row.name),
    clientName: nullableString(row.client_name), endpointUrl: stringValue(row.endpoint_url),
    protocol: row.protocol === "coval" ? "coval" : "openai", authType: authTypeValue(row.auth_type),
    authToken: decrypted.ok ? (decrypted.value || null) : null, authHeaderName: nullableString(row.auth_header_name),
    systemPrompt: stringValue(row.system_prompt), agentFamily: agentFamilyValue(row.agent_family),
    mode: modeValue(row.mode), tools: parseArray(row.tools_json), active: Boolean(row.active),
    source: sourceValue(row.source), externalId: nullableString(row.external_id),
    lastTraceAt: nullableNumber(row.last_trace_at), createdAt: numberValue(row.created_at), updatedAt: numberValue(row.updated_at),
  };
}

function traceFromRow(row: SharedRow): TraceRecord {
  return { workspaceId: stringValue(row.workspace_id), eventId: stringValue(row.event_id), traceId: stringValue(row.trace_id), agentId: stringValue(row.agent_id), deployment: nullableString(row.deployment), version: nullableString(row.version), parentId: nullableString(row.parent_id), kind: stringValue(row.kind), input: parseJson(row.input_json), output: parseJson(row.output_json), toolName: nullableString(row.tool_name), toolArguments: parseJson(row.tool_arguments_json), toolResult: parseJson(row.tool_result_json), latencyMs: nullableNumber(row.latency_ms), status: nullableString(row.status), assertion: parseJson(row.assertion_json), occurredAt: numberValue(row.occurred_at), metadata: parseJson(row.metadata_json) as Record<string, string> | null };
}

function caseFromRow(row: SharedRow): RegressionCaseRecord {
  return { id: stringValue(row.id), workspaceId: stringValue(row.workspace_id), agentId: stringValue(row.agent_id), sourceTraceId: stringValue(row.source_trace_id), suiteId: nullableString(row.suite_id), name: stringValue(row.name), inputText: stringValue(row.input_json), assertionName: stringValue(row.assertion_name), assertionDetail: nullableString(row.assertion_detail), evaluator: evaluatorFromJson(row.evaluator_json), expectedPass: Boolean(row.expected_pass), lastStatus: regressionStatusValue(row.last_status), lastPassed: nullableBoolean(row.last_passed), lastLatencyMs: nullableNumber(row.last_latency_ms), lastError: nullableString(row.last_error), lastRunAt: nullableNumber(row.last_run_at), createdAt: numberValue(row.created_at), updatedAt: numberValue(row.updated_at) };
}

function evaluatorFromJson(value: unknown): EvaluatorDefinition | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
  if (parsed.type === "model") return { type: "model" };
  if (parsed.type === "contains" && typeof parsed.value === "string") return { type: "contains", value: parsed.value, caseSensitive: parsed.caseSensitive === true };
  if (parsed.type === "regex" && typeof parsed.pattern === "string") return { type: "regex", pattern: parsed.pattern, flags: typeof parsed.flags === "string" ? parsed.flags : "" };
  if (parsed.type === "exact_json" && "value" in parsed) return { type: "exact_json", value: parsed.value };
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gateFromRow(row: SharedRow): RegressionGateRunRecord {
  return { id: stringValue(row.id), workspaceId: stringValue(row.workspace_id), version: stringValue(row.version), baselineVersion: nullableString(row.baseline_version), status: gateStatusValue(row.status), total: numberValue(row.total), passed: numberValue(row.passed), failed: numberValue(row.failed), errors: numberValue(row.errors), regressions: numberValue(row.regressions), createdAt: numberValue(row.created_at), completedAt: nullableNumber(row.completed_at) };
}

function gateCaseFromRow(row: SharedRow): RegressionGateCaseResultRecord {
  return { gateRunId: stringValue(row.gate_run_id), workspaceId: stringValue(row.workspace_id), caseId: stringValue(row.case_id), agentId: stringValue(row.agent_id), status: regressionStatusValue(row.status) ?? "error", passed: nullableBoolean(row.passed), baselineStatus: regressionStatusValue(row.baseline_status), regression: Boolean(row.regression), latencyMs: nullableNumber(row.latency_ms), error: nullableString(row.error), createdAt: numberValue(row.created_at) };
}

function runFromRow(row: SharedRow): RunRow {
  return { id: stringValue(row.id), workspaceId: stringValue(row.workspace_id), agentId: nullableString(row.agent_id), agentName: stringValue(row.agent_name), clientName: nullableString(row.client_name), endpointUrl: stringValue(row.endpoint_url), status: runStatusValue(row.status), progress: parseJson(row.progress_json) as RunRow["progress"], report: parseJson(row.report_json) as RunRow["report"], error: nullableString(row.error), createdAt: numberValue(row.created_at) };
}

function json(value: unknown): string | null { return value === null || value === undefined ? null : JSON.stringify(value); }
function parseJson(value: unknown): unknown | null { if (typeof value !== "string" || !value) return null; try { return JSON.parse(value) as unknown; } catch { return null; } }
function parseArray(value: unknown): AgentRow["tools"] { const parsed = parseJson(value); return Array.isArray(parsed) ? parsed as AgentRow["tools"] : []; }
function stringValue(value: unknown): string { return typeof value === "string" ? value : String(value ?? ""); }
function nullableString(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function numberValue(value: unknown): number { return typeof value === "number" ? value : Number(value ?? 0); }
function nullableNumber(value: unknown): number | null { return value === null || value === undefined ? null : numberValue(value); }
function nullableBoolean(value: unknown): boolean | null { return value === null || value === undefined ? null : Boolean(value); }
function roleValue(value: unknown): WorkspaceKeyRecord["role"] { return value === "owner" || value === "admin" || value === "viewer" ? value : "developer"; }
function authTypeValue(value: unknown): AgentRow["authType"] { return value === "bearer" || value === "header" ? value : "none"; }
function agentFamilyValue(value: unknown): AgentRow["agentFamily"] { return value === "anthropic" || value === "openai" ? value : "unknown"; }
function modeValue(value: unknown): AgentRow["mode"] { return value === "auto" || value === "conversational" || value === "task" ? value : null; }
function sourceValue(value: unknown): AgentRow["source"] { return value === "sdk" || value === "mcp" || value === "ci" ? value : "manual"; }
function regressionStatusValue(value: unknown): RegressionCaseStatus | null { return value === "pass" || value === "fail" || value === "error" ? value : null; }
function gateStatusValue(value: unknown): RegressionGateStatus { return value === "running" || value === "pass" || value === "fail" ? value : "error"; }
function runStatusValue(value: unknown): RunRow["status"] { return value === "queued" || value === "running" || value === "done" ? value : "error"; }
