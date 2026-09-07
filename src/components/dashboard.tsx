"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button, Corner, Field, Panel, TextArea, TextInput } from "./ui";

type RunStatus = "queued" | "running" | "done" | "error";
type AgentFamily = "anthropic" | "openai" | "unknown";
type AgentMode = "auto" | "conversational" | "task";
type Protocol = "openai" | "coval";
type AuthType = "none" | "bearer" | "header";

interface RunSummary {
  id: string;
  status: RunStatus;
  score: number | null;
  certified: boolean | null;
  createdAt: number;
  error: string | null;
}

interface AgentRow {
  agent: {
    id: string;
    name: string;
    clientName: string | null;
    endpointUrl: string;
    protocol: Protocol;
    authType: AuthType;
    authHeaderName: string | null;
    agentFamily: AgentFamily;
    mode: AgentMode | null;
    toolCount: number;
    active: boolean;
    authConfigured: boolean;
    createdAt: number;
    updatedAt: number;
  };
  latestRun: RunSummary | null;
  history: RunSummary[];
}

interface FormState {
  name: string;
  clientName: string;
  endpointUrl: string;
  protocol: Protocol;
  authType: AuthType;
  authToken: string;
  authHeaderName: string;
  systemPrompt: string;
  agentFamily: AgentFamily;
  mode: AgentMode;
}

const EMPTY_FORM: FormState = {
  name: "",
  clientName: "",
  endpointUrl: "",
  protocol: "openai",
  authType: "none",
  authToken: "",
  authHeaderName: "",
  systemPrompt: "",
  agentFamily: "unknown",
  mode: "auto",
};

export function Dashboard() {
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | "all" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      if (!response.ok) throw new Error("no se pudo leer el dashboard");
      const json: unknown = await response.json();
      if (!isDashboardPayload(json)) throw new Error("respuesta inválida del dashboard");
      setRows(json.agents);
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "no se pudo leer el dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const hasActiveRuns = rows.some(
    (row) => row.latestRun?.status === "queued" || row.latestRun?.status === "running",
  );
  useEffect(() => {
    if (!hasActiveRuns) return;
    const timer = window.setInterval(() => void load(), 1800);
    return () => window.clearInterval(timer);
  }, [hasActiveRuns]);

  const metrics = useMemo(() => {
    const latest = rows.map((row) => row.latestRun).filter((run): run is RunSummary => run !== null);
    const completed = latest.filter((run) => run.status === "done");
    const certified = completed.filter((run) => run.certified === true);
    const scores = completed.flatMap((run) => (run.score === null ? [] : [run.score]));
    return {
      total: rows.length,
      active: rows.filter((row) => row.agent.active).length,
      queued: latest.filter((run) => run.status === "queued").length,
      running: latest.filter((run) => run.status === "running").length,
      completed: latest.filter((run) => run.status === "done").length,
      certified: certified.length,
      average: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) : null,
    };
  }, [rows]);

  async function runAgent(agentId: string) {
    setRunning(agentId);
    setNotice(null);
    try {
      const response = await fetch(`/api/agents/${agentId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioCount: 10, k: 1 }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "no se pudo iniciar el eval");
      setNotice("Eval encolado · 10 escenarios × 1");
      await load();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "no se pudo iniciar el eval");
    } finally {
      setRunning(null);
    }
  }

  async function runAll() {
    setRunning("all");
    setNotice(null);
    try {
      const response = await fetch("/api/agents/run-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioCount: 10, k: 1 }),
      });
      const json = (await response.json()) as { error?: string; queued?: number };
      if (!response.ok) throw new Error(json.error ?? "no se pudo iniciar el batch");
      setNotice(`${json.queued ?? 0} agents encolados · scheduler limitado a 2 concurrentes`);
      await load();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "no se pudo iniciar el batch");
    } finally {
      setRunning(null);
    }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          clientName: form.clientName || undefined,
          authToken: form.authToken || undefined,
          authHeaderName: form.authHeaderName || undefined,
          tools: [],
        }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "no se pudo registrar el agent");
      setForm(EMPTY_FORM);
      setFormOpen(false);
      setNotice("Agent registrado · listo para comparar");
      await load();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "no se pudo registrar el agent");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="content mx-auto max-w-7xl px-6 pb-32">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b py-5">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="font-display text-xl font-900 tracking-tight">GAUNTLET</span>
          <span className="label">/ fleet dashboard</span>
        </Link>
        <nav className="flex gap-6">
          <Link href="/" className="label transition-colors hover:text-[var(--color-signal)]">nueva corrida ↗</Link>
          <Link href="/runs" className="label transition-colors hover:text-[var(--color-signal)]">historial ↗</Link>
        </nav>
      </header>

      <section className="flex flex-col justify-between gap-8 pt-14 md:flex-row md:items-end">
        <div>
          <div className="label mb-4">control plane · black-box evals</div>
          <h1 className="font-display text-5xl font-900 leading-[0.92] tracking-tight md:text-7xl">
            Todos tus agentes.
            <br />
            <span style={{ color: "var(--color-signal)" }}>Una señal.</span>
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
            Registrá endpoints distintos, corré el mismo protocolo de evaluación y compará score,
            certificación y regresiones en un solo lugar.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Button variant="ghost" onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? "cerrar" : "+ registrar agent"}
          </Button>
          <Button onClick={() => void runAll()} disabled={running !== null || metrics.active === 0}>
            {running === "all" ? "iniciando…" : "correr todos →"}
          </Button>
        </div>
      </section>

      {notice ? (
        <div className="mt-8 border px-4 py-3 text-xs" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>
          {notice}
        </div>
      ) : null}

      <section className="mt-12 grid grid-cols-2 gap-px border md:grid-cols-7" style={{ borderColor: "var(--color-line-bright)" }}>
        <Metric value={metrics.total} label="agentes" />
        <Metric value={metrics.active} label="activos" />
        <Metric value={metrics.queued} label="en cola" tone="warn" />
        <Metric value={metrics.running} label="corriendo" tone="warn" />
        <Metric value={metrics.completed} label="completados" />
        <Metric value={metrics.average === null ? "—" : `${metrics.average}%`} label="promedio último" />
        <Metric value={metrics.certified} label="certificados" tone="signal" />
      </section>

      {formOpen ? <AgentForm form={form} setForm={setForm} saving={saving} onSubmit={register} /> : null}

      <section className="mt-12">
        <div className="mb-5 flex items-center justify-between">
          <div className="label">fleet / {rows.length.toString().padStart(2, "0")} targets</div>
          {hasActiveRuns ? <div className="label" style={{ color: "var(--color-warn)" }}>● polling live</div> : null}
        </div>
        {loading ? <div className="border p-10 text-sm" style={{ color: "var(--color-ink-dim)" }}>cargando fleet…</div> : null}
        {!loading && rows.length === 0 ? <EmptyFleet onRegister={() => setFormOpen(true)} /> : null}
        <div className="grid gap-px border md:grid-cols-2" style={{ borderColor: "var(--color-line-bright)" }}>
          {rows.map((row) => (
            <AgentCard
              key={row.agent.id}
              row={row}
              busy={running === row.agent.id || running === "all"}
              onRun={() => void runAgent(row.agent.id)}
            />
          ))}
        </div>
      </section>

      <TechnicalEdge />
    </main>
  );
}

function Metric({ value, label, tone = "default" }: { value: number | string; label: string; tone?: "default" | "warn" | "signal" }) {
  const color = tone === "warn" ? "var(--color-warn)" : tone === "signal" ? "var(--color-signal)" : "var(--color-ink)";
  return <div className="bg-[var(--color-panel)] p-5"><div className="font-display text-2xl font-800" style={{ color }}>{value}</div><div className="label mt-1 normal-case tracking-normal">{label}</div></div>;
}

function AgentCard({ row, busy, onRun }: { row: AgentRow; busy: boolean; onRun: () => void }) {
  const latest = row.latestRun;
  const status = latest?.status ?? "idle";
  const statusLabel = status === "queued" ? "en cola" : status === "running" ? "corriendo" : status === "done" ? latest?.certified ? "certificado" : "completado" : status === "error" ? "error" : "sin eval";
  const statusColor = status === "error" ? "var(--color-fail)" : status === "running" || status === "queued" ? "var(--color-warn)" : latest?.certified ? "var(--color-signal)" : "var(--color-ink-dim)";
  return (
    <Panel className="relative overflow-hidden p-6">
      <Corner />
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0" style={{ background: statusColor }} />
            <h2 className="truncate font-display text-xl font-800">{row.agent.name}</h2>
          </div>
          <div className="label mt-2 truncate normal-case tracking-normal">{row.agent.clientName ?? "sin cliente"} · {row.agent.protocol} · {row.agent.mode ?? "auto"}</div>
        </div>
        <div className="text-right">
          {latest ? (
            <Link href={`/runs/${latest.id}`} className="block transition-opacity hover:opacity-70">
              <div className="font-display text-4xl font-900" style={{ color: latest.score === null ? "var(--color-ink-faint)" : statusColor }}>
                {latest.score === null ? "—" : `${Math.round(latest.score * 100)}`}
              </div>
              <div className="label mt-1">score / 100 ↗</div>
            </Link>
          ) : (
            <><div className="font-display text-4xl font-900" style={{ color: "var(--color-ink-faint)" }}>—</div><div className="label mt-1">score / 100</div></>
          )}
        </div>
      </div>
      <div className="mt-7 flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <ScoreSparkline history={row.history} />
          <div className="mt-2 flex items-center justify-between gap-3 text-xs" style={{ color: statusColor }}>
            <span>{statusLabel}</span>
            <span style={{ color: "var(--color-ink-faint)" }}>{latest ? formatAge(latest.createdAt) : "listo para medir"}</span>
          </div>
        </div>
        <Button variant="ghost" onClick={onRun} disabled={busy || !row.agent.active}>
          {busy ? "…" : "eval 10×1"}
        </Button>
      </div>
      <div className="mt-6 flex gap-4 border-t pt-4 text-xs" style={{ color: "var(--color-ink-faint)" }}>
        <span>{row.history.length} corridas visibles</span>
        <span>{row.agent.toolCount} tools</span>
        <span>{row.agent.authConfigured ? "auth ok" : "sin auth"}</span>
      </div>
    </Panel>
  );
}

function ScoreSparkline({ history }: { history: RunSummary[] }) {
  const scores = history.filter((run) => run.score !== null).reverse();
  if (scores.length === 0) return <div className="flex h-11 items-center border-b border-dashed text-xs" style={{ color: "var(--color-ink-faint)" }}>sin datos todavía</div>;
  const points = scores.map((run, index) => {
    const x = scores.length === 1 ? 90 : 6 + (index / (scores.length - 1)) * 168;
    const score = Math.max(0, Math.min(1, run.score ?? 0));
    const y = 37 - score * 30;
    return `${x},${y}`;
  }).join(" ");
  return <svg viewBox="0 0 180 42" className="h-11 w-full" role="img" aria-label="tendencia de score"><path d="M 0 37 H 180" stroke="var(--color-line-bright)" /><polyline points={points} fill="none" stroke="var(--color-signal)" strokeWidth="2" /><circle cx={points.split(" ").at(-1)?.split(",")[0]} cy={points.split(" ").at(-1)?.split(",")[1]} r="3" fill="var(--color-signal)" /></svg>;
}

function AgentForm({ form, setForm, saving, onSubmit }: { form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>>; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <form onSubmit={onSubmit} className="relative mt-8 grid gap-6 border bg-[var(--color-panel)] p-6 md:grid-cols-2" style={{ borderColor: "var(--color-signal)" }}>
      <Corner />
      <div className="md:col-span-2"><div className="label mb-1" style={{ color: "var(--color-signal)" }}>new target</div><p className="text-sm" style={{ color: "var(--color-ink-dim)" }}>Las credenciales se guardan en SQLite del servidor y nunca vuelven en la respuesta.</p></div>
      <Field label="nombre"><TextInput required value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Support v3" /></Field>
      <Field label="cliente"><TextInput value={form.clientName} onChange={(event) => update("clientName", event.target.value)} placeholder="Acme" /></Field>
      <Field label="endpoint" hint="OpenAI-compatible /v1/chat/completions o Coval"><TextInput required type="url" value={form.endpointUrl} onChange={(event) => update("endpointUrl", event.target.value)} placeholder="https://agent.example.com/v1/chat/completions" /></Field>
      <Field label="system prompt"><TextArea required rows={4} value={form.systemPrompt} onChange={(event) => update("systemPrompt", event.target.value)} placeholder="Pegá el system prompt que querés evaluar…" /></Field>
      <Field label="protocol"><select value={form.protocol} onChange={(event) => update("protocol", event.target.value as Protocol)} className="w-full bg-[var(--color-void)] border px-3 py-2.5 text-sm"><option value="openai">OpenAI-compatible</option><option value="coval">Coval</option></select></Field>
      <Field label="familia del agente"><select value={form.agentFamily} onChange={(event) => update("agentFamily", event.target.value as AgentFamily)} className="w-full bg-[var(--color-void)] border px-3 py-2.5 text-sm"><option value="unknown">Auto / unknown</option><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></Field>
      <Field label="modo"><select value={form.mode} onChange={(event) => update("mode", event.target.value as AgentMode)} className="w-full bg-[var(--color-void)] border px-3 py-2.5 text-sm"><option value="auto">Inferir del prompt</option><option value="conversational">Conversacional</option><option value="task">Task / single-shot</option></select></Field>
      <Field label="auth"><select value={form.authType} onChange={(event) => update("authType", event.target.value as AuthType)} className="w-full bg-[var(--color-void)] border px-3 py-2.5 text-sm"><option value="none">Sin auth</option><option value="bearer">Bearer token</option><option value="header">Header custom</option></select></Field>
      {form.authType === "header" ? <Field label="nombre del header"><TextInput value={form.authHeaderName} onChange={(event) => update("authHeaderName", event.target.value)} placeholder="x-api-key" /></Field> : <div />}
      {form.authType !== "none" ? <Field label="token"><TextInput type="password" value={form.authToken} onChange={(event) => update("authToken", event.target.value)} placeholder="••••••••" /></Field> : <div />}
      <div className="md:col-span-2"><Button type="submit" disabled={saving}>{saving ? "guardando…" : "registrar agent →"}</Button></div>
    </form>
  );
}

function EmptyFleet({ onRegister }: { onRegister: () => void }) {
  return <div className="border p-10" style={{ borderColor: "var(--color-line-bright)" }}><div className="label mb-3">fleet vacía</div><p className="max-w-lg text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>Registrá el primer endpoint para comparar agentes con el mismo set de escenarios y la misma política de scoring.</p><div className="mt-6 flex flex-wrap gap-3"><button onClick={onRegister} className="bg-[var(--color-signal)] px-5 py-3 text-xs font-semibold uppercase tracking-widest text-[var(--color-void)]">registrar primer agent →</button><Link href="/benchmark" className="border px-5 py-3 text-xs font-semibold uppercase tracking-widest transition-colors hover:border-[var(--color-signal)] hover:text-[var(--color-signal)]">ver benchmark</Link></div></div>;
}

function TechnicalEdge() {
  return <section className="mt-20 grid gap-px border md:grid-cols-3" style={{ borderColor: "var(--color-line-bright)" }}><Edge title="Un solo engine" copy="Cada target termina en runEval: mismo profiler, escenarios, juez y certificado. La comparación no depende de una integración distinta por agente." /><Edge title="Backpressure real" copy="Run all persiste toda la tanda como queued y libera sólo dos ejecuciones a la vez. Evita saturar endpoints y hace visible el estado." /><Edge title="Datos sin maquillaje" copy="El dashboard expone score, estado, historial y errores; no muestra prompts ni tokens. La señal sale de corridas reproducibles, no de claims." /></section>;
}

function Edge({ title, copy }: { title: string; copy: string }) {
  return <div className="bg-[var(--color-panel)] p-6"><div className="label mb-3" style={{ color: "var(--color-signal)" }}>technical edge</div><h2 className="font-display text-lg font-800">{title}</h2><p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>{copy}</p></div>;
}

function formatAge(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function isDashboardPayload(value: unknown): value is { agents: AgentRow[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { agents?: unknown }).agents);
}
