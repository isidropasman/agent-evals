import { parseTraceEnvelope, type ParseResult } from "./http-input";
import type { TraceEnvelope } from "./trace-store";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_METADATA_KEYS = 50;
const MAX_STRING_LENGTH = 5000;

export function normalizeTraceEnvelope(raw: unknown): ParseResult<TraceEnvelope> {
  const parsed = parseTraceEnvelope(raw);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!boundedId(value.traceId) || !boundedId(value.eventId) || !boundedId(value.agentId)) return { ok: false, error: "trace identifiers are too long" };
  if ([value.input, value.output, value.toolArguments, value.toolResult, value.assertion, value.metadata].some((payload) => payload !== undefined && byteLength(payload) > MAX_PAYLOAD_BYTES)) return { ok: false, error: "trace payload exceeds 64 KiB" };
  const normalized: TraceEnvelope = {
    ...value,
    traceId: value.traceId.trim(),
    eventId: value.eventId.trim(),
    agentId: value.agentId.trim(),
    deployment: boundedOptional(value.deployment),
    version: boundedOptional(value.version),
    parentId: boundedOptional(value.parentId),
    toolName: boundedOptional(value.toolName),
    input: normalizePayload(value.input),
    output: normalizePayload(value.output),
    toolArguments: normalizePayload(value.toolArguments),
    toolResult: normalizePayload(value.toolResult),
    assertion: value.assertion ? { name: boundedString(value.assertion.name), passed: value.assertion.passed, detail: boundedOptional(value.assertion.detail) } : undefined,
    metadata: value.metadata ? normalizeMetadata(value.metadata) : undefined,
  };
  const payloads = [normalized.input, normalized.output, normalized.toolArguments, normalized.toolResult, normalized.assertion, normalized.metadata];
  if (payloads.some((payload) => payload !== undefined && byteLength(payload) > MAX_PAYLOAD_BYTES)) return { ok: false, error: "trace payload exceeds 64 KiB" };
  return { ok: true, value: normalized };
}

export function redactTracePayload(value: unknown, depth = 0): unknown | null {
  if (value === undefined || value === null) return null;
  if (depth > 8) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactTracePayload(item, depth + 1));
  if (!isRecord(value)) return typeof value === "string" ? boundedString(value) : value;
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, nested]) => [key, isSensitiveKey(key) ? "[REDACTED]" : redactTracePayload(nested, depth + 1)]));
}

function normalizePayload(value: unknown): unknown {
  return value === undefined ? undefined : redactTracePayload(value);
}

function normalizeMetadata(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).slice(0, MAX_METADATA_KEYS).map(([key, nested]) => [boundedString(key), boundedString(nested)]));
}

function boundedId(value: string): boolean { return value.trim().length > 0 && value.trim().length <= 200; }
function boundedString(value: string): string { return value.slice(0, MAX_STRING_LENGTH); }
function boundedOptional(value: string | undefined): string | undefined { return value ? boundedString(value) : undefined; }
function byteLength(value: unknown): number { return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8"); }
function isSensitiveKey(key: string): boolean { return /(token|secret|password|authorization|api[-_]?key|cookie|credential|private[-_]?key|session)/i.test(key); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
