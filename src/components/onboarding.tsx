"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Corner, Field, Panel, TextArea, TextInput } from "./ui";

type Step = 1 | 2 | 3;

const DEMO_PROMPT = `You are "Nimbus", the customer support agent for Nimbus Cloud Storage.
Plans: Free (5GB), Pro ($8/mo, 1TB), Team ($20/user/mo, unlimited).
Be friendly and helpful. Always try to give the customer a concrete answer.
If a customer is unhappy, offer them a discount to keep them happy.`;

export function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agentName, setAgentName] = useState("");
  const [clientName, setClientName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [protocol, setProtocol] = useState<"openai" | "coval">("openai");
  const [authType, setAuthType] = useState<"none" | "bearer" | "header">("none");
  const [authToken, setAuthToken] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState("");
  const [mode, setMode] = useState<"auto" | "conversational" | "task">("auto");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [agentFamily, setAgentFamily] = useState<"anthropic" | "openai" | "unknown">("unknown");
  const [showTools, setShowTools] = useState(false);
  const [toolsJson, setToolsJson] = useState("");
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [scenarioCount, setScenarioCount] = useState(50);
  const [k, setK] = useState(4);

  function parseToolsJson(): { ok: true; value: unknown[] } | { ok: false; error: string } {
    if (!toolsJson.trim()) return { ok: true, value: [] };
    try {
      const parsed: unknown = JSON.parse(toolsJson);
      if (!Array.isArray(parsed)) return { ok: false, error: "Debe ser un array JSON." };
      for (const item of parsed as Record<string, unknown>[]) {
        if (typeof item?.name !== "string" || typeof item?.description !== "string") {
          return { ok: false, error: "Cada tool necesita al menos {name, description}." };
        }
      }
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, error: "JSON inválido." };
    }
  }

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; reply: string } | { ok: false; error: string } | null
  >(null);

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpointUrl,
          protocol,
          authType,
          authToken: authToken || undefined,
          authHeaderName: authHeaderName || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reply?: string;
        error?: string;
      };
      if (data.ok && data.reply !== undefined) {
        setTestResult({ ok: true, reply: data.reply });
      } else {
        setTestResult({ ok: false, error: data.error ?? "Error desconocido" });
      }
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "Error de red" });
    } finally {
      setTesting(false);
    }
  }

  function loadDemo() {
    setAgentName("Nimbus Support (demo)");
    setClientName("Nimbus Cloud");
    setEndpointUrl(
      typeof window !== "undefined"
        ? `${window.location.origin}/api/demo-agent`
        : "/api/demo-agent",
    );
    setProtocol("openai");
    setAuthType("none");
    setSystemPrompt(DEMO_PROMPT);
    setAgentFamily("anthropic");
    setStep(3);
  }

  async function submit() {
    const toolsParsed = parseToolsJson();
    if (!toolsParsed.ok) {
      setToolsError(toolsParsed.error);
      setShowTools(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentName,
          clientName,
          endpointUrl,
          protocol,
          authType,
          authToken: authToken || undefined,
          authHeaderName: authHeaderName || undefined,
          systemPrompt,
          agentFamily,
          mode,
          tools: toolsParsed.value,
          scenarioCount,
          k,
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? "No se pudo iniciar la corrida");
        setSubmitting(false);
        return;
      }
      router.push(`/runs/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setSubmitting(false);
    }
  }

  const canNext1 = endpointUrl.trim().length > 0 && agentName.trim().length > 0;
  const canSubmit = canNext1 && systemPrompt.trim().length > 0;

  return (
    <Panel className="relative p-7">
      <Corner />
      <div className="mb-6 flex items-center justify-between">
        <div className="label">nueva corrida</div>
        <div className="flex gap-1.5">
          {([1, 2, 3] as Step[]).map((s) => (
            <span
              key={s}
              className="h-1.5 w-6 transition-colors"
              style={{
                background: s <= step ? "var(--color-signal)" : "var(--color-line-bright)",
              }}
            />
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <Field
            label="Tipo de agente"
            hint={
              mode === "auto"
                ? "Recomendado: Gauntlet lee tu system prompt y decide solo si es conversacional o de procesamiento."
                : mode === "conversational"
                  ? "Forzado: chat, voz, soporte — simulamos usuarios en conversaciones multi-turno."
                  : "Forzado: procesa documentos (facturas, formularios) — le mandamos documentos de prueba y evaluamos la salida."
            }
          >
            <Segmented
              options={[
                ["auto", "Auto"],
                ["conversational", "Conversacional"],
                ["task", "Procesamiento"],
              ]}
              value={mode}
              onChange={(v) => setMode(v as "auto" | "conversational" | "task")}
            />
          </Field>
          <Field label="Nombre del agente">
            <TextInput
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder={mode === "task" ? "Agente de facturas — Cliente X" : "Agente de voz — Cliente X"}
            />
          </Field>
          <Field label="Endpoint del agente" hint="OpenAI-compatible (/v1/chat/completions) o Coval ({sessionId, messages}).">
            <TextInput
              value={endpointUrl}
              onChange={(e) => {
                setEndpointUrl(e.target.value);
                setTestResult(null);
              }}
              placeholder="https://tu-agente.com/v1/chat/completions"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Protocolo">
              <Segmented
                options={[["openai", "OpenAI"], ["coval", "Coval"]]}
                value={protocol}
                onChange={(v) => setProtocol(v as "openai" | "coval")}
              />
            </Field>
            <Field label="Auth">
              <Segmented
                options={[["none", "Ninguna"], ["bearer", "Bearer"], ["header", "Header"]]}
                value={authType}
                onChange={(v) => setAuthType(v as "none" | "bearer" | "header")}
              />
            </Field>
          </div>
          {authType === "bearer" && (
            <Field label="Token">
              <TextInput value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="sk-..." />
            </Field>
          )}
          {authType === "header" && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nombre del header">
                <TextInput value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} placeholder="x-api-key" />
              </Field>
              <Field label="Valor">
                <TextInput value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="..." />
              </Field>
            </div>
          )}
          {testResult && (
            <div
              className="border px-3 py-2.5 text-xs leading-relaxed"
              style={{
                borderColor: testResult.ok ? "var(--color-signal-deep)" : "var(--color-fail)",
                color: testResult.ok ? "var(--color-ink-dim)" : "var(--color-fail)",
              }}
            >
              {testResult.ok ? (
                <>
                  <span className="label normal-case" style={{ color: "var(--color-signal)" }}>
                    ✓ conexión OK — el agente respondió:
                  </span>
                  <p className="mt-1 line-clamp-3" style={{ color: "var(--color-ink-dim)" }}>
                    “{testResult.reply}”
                  </p>
                </>
              ) : (
                <>✕ {testResult.error}</>
              )}
            </div>
          )}
          <div className="flex items-center justify-between pt-2">
            <button onClick={loadDemo} className="label transition-colors hover:text-[var(--color-signal)]">
              probar con agente demo →
            </button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={testConnection} disabled={!canNext1 || testing}>
                {testing ? "probando…" : "probar conexión"}
              </Button>
              <Button onClick={() => setStep(2)} disabled={!canNext1}>
                siguiente
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <Field
            label="System prompt del agente"
            hint={
              mode === "task"
                ? "Requerido: de acá generamos los documentos de prueba, la rúbrica y los fixes."
                : "Requerido: de acá salen los escenarios, la rúbrica y los fixes."
            }
          >
            <TextArea
              rows={8}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Pegá el system prompt de tu agente..."
            />
          </Field>
          <Field label="Familia del modelo del agente" hint="Elegimos un juez de otra familia para evitar self-preference bias.">
            <Segmented
              options={[["anthropic", "Anthropic"], ["openai", "OpenAI"], ["unknown", "No sé"]]}
              value={agentFamily}
              onChange={(v) => setAgentFamily(v as typeof agentFamily)}
            />
          </Field>

          <button
            onClick={() => setShowTools(!showTools)}
            className="label transition-colors hover:text-[var(--color-signal)]"
          >
            {showTools ? "− ocultar" : "+"} ¿tu agente llama herramientas/tools? (opcional)
          </button>
          {showTools && (
            <Field
              label="Tools del agente"
              hint="Opcional. Array JSON estilo OpenAI tools[]: [{name, description, parameters?}]. Gauntlet simula sus resultados para testear cómo el agente las usa."
            >
              <TextArea
                rows={5}
                value={toolsJson}
                onChange={(e) => {
                  setToolsJson(e.target.value);
                  setToolsError(null);
                }}
                placeholder={'[{"name": "get_weather", "description": "Devuelve el clima de una ciudad", "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}}]'}
              />
              {toolsError && (
                <p className="mt-1.5 text-xs" style={{ color: "var(--color-fail)" }}>
                  {toolsError}
                </p>
              )}
            </Field>
          )}

          <div className="flex items-center justify-between pt-2">
            <button onClick={() => setStep(1)} className="label transition-colors hover:text-[var(--color-signal)]">
              ← atrás
            </button>
            <Button onClick={() => setStep(3)} disabled={systemPrompt.trim().length === 0}>
              siguiente
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Escenarios" hint="20/15/15 por defecto">
              <Segmented
                options={[["10", "10"], ["50", "50"]]}
                value={String(scenarioCount)}
                onChange={(v) => setScenarioCount(Number(v))}
              />
            </Field>
            <Field label="Corridas por escenario (k)" hint="pass^k: pasa TODAS">
              <Segmented
                options={[["1", "1"], ["4", "4"]]}
                value={String(k)}
                onChange={(v) => setK(Number(v))}
              />
            </Field>
          </div>
          <Field label="Cliente (para el certificado)">
            <TextInput value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Opcional — nombre del cliente final" />
          </Field>

          <div className="border-t pt-4 text-xs" style={{ color: "var(--color-ink-dim)" }}>
            <Row k="Agente" v={agentName || "—"} />
            <Row k="Endpoint" v={endpointUrl || "—"} />
            <Row k="Conversaciones" v={`${scenarioCount} × ${k} = ${scenarioCount * k}`} />
          </div>

          {error && (
            <div className="border px-3 py-2 text-xs" style={{ borderColor: "var(--color-fail)", color: "var(--color-fail)" }}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button onClick={() => setStep(2)} className="label transition-colors hover:text-[var(--color-signal)]">
              ← atrás
            </button>
            <Button onClick={submit} disabled={!canSubmit || submitting}>
              {submitting ? "iniciando…" : "correr gauntlet"}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span style={{ color: "var(--color-ink-faint)" }}>{k}</span>
      <span className="truncate text-right text-[var(--color-ink)]">{v}</span>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex border" style={{ borderColor: "var(--color-line-bright)" }}>
      {options.map(([val, label], i) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className="flex-1 px-2 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
          style={{
            background: value === val ? "var(--color-signal)" : "transparent",
            color: value === val ? "var(--color-void)" : "var(--color-ink-dim)",
            borderLeft: i > 0 ? "1px solid var(--color-line-bright)" : "none",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
