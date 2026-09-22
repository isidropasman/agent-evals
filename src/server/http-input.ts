import type { AgentRegistration } from "./agent-store";
import type { PromoteTraceInput } from "./regression-store";
import type { RegressionGateInput } from "./gate-runner";
import type { TraceEnvelope, TraceKind, TraceStatus } from "./trace-store";
import { parseEvaluatorDefinition, type EvaluatorDefinition } from "@/engine/evaluators";
import type { DatasetItemInput } from "./dataset-store";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface DatasetVersionInput {
  name: string;
  version: string;
  items: DatasetItemInput[];
}

export interface SuiteInput {
  name: string;
  version: string;
  datasetVersionId: string;
  agentId?: string;
  maxCases?: number;
  concurrency?: number;
}

export function parseSuiteInput(raw: unknown): ParseResult<SuiteInput> {
  if (!isRecord(raw)) return { ok: false, error: "body debe ser un objeto" };
  const name = stringValue(raw.name);
  const version = stringValue(raw.version);
  const datasetVersionId = stringValue(raw.datasetVersionId);
  if (!name || name.length > 100 || !version || version.length > 100 || !datasetVersionId) return { ok: false, error: "name, version y datasetVersionId son obligatorios" };
  const maxCases = raw.maxCases;
  const concurrency = raw.concurrency;
  if (maxCases !== undefined && (typeof maxCases !== "number" || !Number.isInteger(maxCases) || maxCases < 1 || maxCases > 1000)) return { ok: false, error: "maxCases debe ser un entero entre 1 y 1000" };
  if (concurrency !== undefined && (typeof concurrency !== "number" || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)) return { ok: false, error: "concurrency debe ser un entero entre 1 y 8" };
  return { ok: true, value: { name, version, datasetVersionId, agentId: stringValue(raw.agentId), maxCases, concurrency } };
}

export function parseDatasetVersionInput(raw: unknown): ParseResult<DatasetVersionInput> {
  if (!isRecord(raw)) return { ok: false, error: "body debe ser un objeto" };
  const name = stringValue(raw.name);
  const version = stringValue(raw.version);
  if (!name || name.length > 100) return { ok: false, error: "name debe tener entre 1 y 100 caracteres" };
  if (!version || version.length > 100) return { ok: false, error: "version debe tener entre 1 y 100 caracteres" };
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 1000) return { ok: false, error: "items debe tener entre 1 y 1000 elementos" };
  const items: DatasetItemInput[] = [];
  for (const rawItem of raw.items) {
    if (!isRecord(rawItem) || !("input" in rawItem) || rawItem.input === undefined) return { ok: false, error: "cada item debe tener input" };
    const evaluator = parseOptionalEvaluator(rawItem.evaluator);
    if (!evaluator.ok) return evaluator;
    const metadata = parseMetadata(rawItem.metadata);
    if (!metadata.ok) return metadata;
    items.push({ input: rawItem.input, expectedOutput: rawItem.expectedOutput, evaluator: evaluator.value, metadata: metadata.value });
  }
  return { ok: true, value: { name, version, items } };
}

export function parseAgentRegistration(raw: unknown): ParseResult<AgentRegistration> {
  if (!isRecord(raw)) return { ok: false, error: "body debe ser un objeto" };
  const name = stringValue(raw.name);
  const source = raw.source ?? "sdk";
  if (!name) return { ok: false, error: "name es obligatorio" };
  if (!isAgentSource(source)) return { ok: false, error: "source inválido" };
  const protocol = raw.protocol === undefined ? undefined : raw.protocol;
  if (protocol !== undefined && protocol !== "openai" && protocol !== "coval") {
    return { ok: false, error: "protocol debe ser openai o coval" };
  }
  const agentFamily = raw.agentFamily === undefined ? undefined : raw.agentFamily;
  if (agentFamily !== undefined && agentFamily !== "anthropic" && agentFamily !== "openai" && agentFamily !== "unknown") {
    return { ok: false, error: "agentFamily inválido" };
  }
  const mode = raw.mode === undefined ? undefined : raw.mode;
  if (mode !== undefined && mode !== "auto" && mode !== "conversational" && mode !== "task") {
    return { ok: false, error: "mode inválido" };
  }
  const subscriptionConnectionId = raw.subscriptionConnectionId === undefined
    ? undefined
    : stringValue(raw.subscriptionConnectionId);
  if (raw.subscriptionConnectionId !== undefined && !subscriptionConnectionId) return { ok: false, error: "subscriptionConnectionId debe ser un string no vacío" };
  return {
    ok: true,
    value: {
      id: stringValue(raw.id),
      name,
      clientName: stringValue(raw.clientName),
      endpointUrl: stringValue(raw.endpointUrl),
      protocol,
      systemPrompt: stringValue(raw.systemPrompt),
      agentFamily,
      mode,
      source,
      externalId: stringValue(raw.externalId),
    },
  };
}

export function parseTraceEnvelope(raw: unknown): ParseResult<TraceEnvelope> {
  if (!isRecord(raw)) return { ok: false, error: "body debe ser un objeto" };
  const traceId = stringValue(raw.traceId);
  const eventId = stringValue(raw.eventId);
  const agentId = stringValue(raw.agentId);
  const kind = raw.kind;
  const occurredAt = raw.occurredAt;
  if (!traceId || !eventId || !agentId) return { ok: false, error: "traceId, eventId y agentId son obligatorios" };
  if (!isTraceKind(kind)) return { ok: false, error: "kind inválido" };
  if (typeof occurredAt !== "number" || !Number.isFinite(occurredAt)) {
    return { ok: false, error: "occurredAt debe ser un timestamp válido" };
  }
  const status = raw.status === undefined ? undefined : raw.status;
  if (status !== undefined && !isTraceStatus(status)) return { ok: false, error: "status inválido" };
  const assertion = parseAssertion(raw.assertion);
  if (!assertion.ok) return assertion;
  const metadata = parseMetadata(raw.metadata);
  if (!metadata.ok) return metadata;
  if (raw.latencyMs !== undefined && (typeof raw.latencyMs !== "number" || raw.latencyMs < 0 || !Number.isFinite(raw.latencyMs))) {
    return { ok: false, error: "latencyMs debe ser un número positivo" };
  }
  return {
    ok: true,
    value: {
      traceId,
      eventId,
      agentId,
      deployment: stringValue(raw.deployment),
      version: stringValue(raw.version),
      parentId: stringValue(raw.parentId),
      kind,
      input: raw.input,
      output: raw.output,
      toolName: stringValue(raw.toolName),
      toolArguments: raw.toolArguments,
      toolResult: raw.toolResult,
      latencyMs: raw.latencyMs as number | undefined,
      status,
      assertion: assertion.value,
      occurredAt,
      metadata: metadata.value,
    },
  };
}

export function parseKeyName(raw: unknown): ParseResult<string> {
  if (!isRecord(raw)) return { ok: false, error: "body debe ser un objeto" };
  const name = stringValue(raw.name);
  return name ? { ok: true, value: name } : { ok: false, error: "name es obligatorio" };
}

export function parsePromoteTrace(raw: unknown): ParseResult<PromoteTraceInput> {
  if (!isRecord(raw)) return { ok: false, error: "body debe ser un objeto" };
  const agentId = stringValue(raw.agentId);
  const traceId = stringValue(raw.traceId);
  if (!agentId || !traceId) return { ok: false, error: "agentId y traceId son obligatorios" };
  return { ok: true, value: { agentId, traceId, name: stringValue(raw.name) } };
}

export function parseRegressionGateInput(raw: unknown): ParseResult<RegressionGateInput> {
  if (!isRecord(raw)) return { ok: false, error: "body debe ser un objeto" };
  const caseIds = raw.caseIds;
  const suiteId = raw.suiteId === undefined ? undefined : stringValue(raw.suiteId);
  if (raw.suiteId !== undefined && !suiteId) return { ok: false, error: "suiteId debe ser un string no vacío" };
  if (caseIds !== undefined) {
    if (!Array.isArray(caseIds) || caseIds.some((id) => typeof id !== "string" || !id.trim())) {
      return { ok: false, error: "caseIds debe ser un array de strings" };
    }
    const normalized = caseIds.map((id) => id.trim());
    if (new Set(normalized).size !== normalized.length) {
      return { ok: false, error: "caseIds no puede tener duplicados" };
    }
    if (normalized.length === 0) return { ok: false, error: "caseIds no puede estar vacío" };
    if (normalized.length > 100) return { ok: false, error: "caseIds no puede superar 100 casos" };
  }
  const version = raw.version === undefined ? undefined : stringValue(raw.version);
  if (raw.version !== undefined && !version) return { ok: false, error: "version debe ser un string no vacío" };
  if (version && version.length > 200) return { ok: false, error: "version no puede superar 200 caracteres" };
  const concurrency = raw.concurrency;
  if (concurrency !== undefined && (typeof concurrency !== "number" || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)) {
    return { ok: false, error: "concurrency debe ser un entero entre 1 y 8" };
  }
  const subscriptionConnectionId = raw.subscriptionConnectionId === undefined
    ? undefined
    : stringValue(raw.subscriptionConnectionId);
  if (raw.subscriptionConnectionId !== undefined && !subscriptionConnectionId) return { ok: false, error: "subscriptionConnectionId debe ser un string no vacío" };
  return {
    ok: true,
    value: {
      caseIds: caseIds === undefined ? undefined : caseIds.map((id) => id.trim()),
      suiteId,
      version,
      concurrency,
      subscriptionConnectionId,
    },
  };
}

function parseAssertion(
  raw: unknown,
): ParseResult<TraceEnvelope["assertion"]> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.passed !== "boolean") {
    return { ok: false, error: "assertion debe tener name y passed" };
  }
  return {
    ok: true,
    value: { name: raw.name.trim(), passed: raw.passed, detail: stringValue(raw.detail) },
  };
}

function parseMetadata(raw: unknown): ParseResult<Record<string, string> | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!isRecord(raw)) return { ok: false, error: "metadata debe ser un objeto de strings" };
  const entries = Object.entries(raw);
  if (entries.some(([, value]) => typeof value !== "string")) {
    return { ok: false, error: "metadata debe ser un objeto de strings" };
  }
  return { ok: true, value: Object.fromEntries(entries) as Record<string, string> };
}

function parseOptionalEvaluator(raw: unknown): ParseResult<EvaluatorDefinition | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  const parsed = parseEvaluatorDefinition(raw);
  return parsed.ok ? parsed : { ok: false, error: "evaluator inválido" };
}

function isAgentSource(value: unknown): value is AgentRegistration["source"] {
  return value === "manual" || value === "sdk" || value === "mcp" || value === "ci";
}

function isTraceKind(value: unknown): value is TraceKind {
  return value === "run" || value === "turn" || value === "tool_call" || value === "tool_result" || value === "assertion";
}

function isTraceStatus(value: unknown): value is TraceStatus {
  return value === "ok" || value === "error";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
