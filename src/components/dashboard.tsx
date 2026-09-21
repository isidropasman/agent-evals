"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { SUITE_DEFINITIONS, type TestSuite } from "@/engine/suites";
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
  suite: TestSuite | null;
}

interface TraceSummary {
  traceId: string;
  eventId: string;
  agentId: string;
  deployment: string | null;
  version: string | null;
  kind: "run" | "turn" | "tool_call" | "tool_result" | "assertion";
  toolName: string | null;
  latencyMs: number | null;
  status: "ok" | "error" | null;
  assertion: { name: string; passed: boolean; detail?: string } | null;
  occurredAt: number;
  metadata: Record<string, string> | null;
}

interface AgentRow {
  agent: {
    id: string;
    workspaceId: string;
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
    source: "manual" | "sdk" | "mcp" | "ci";
    externalId: string | null;
    lastTraceAt: number | null;
    canRun: boolean;
    createdAt: number;
    updatedAt: number;
  };
  latestRun: RunSummary | null;
  latestTrace: TraceSummary | null;
  history: RunSummary[];
  scoreDelta: number | null;
}

interface ObservabilityStats {
  total: number;
  last24h: number;
  errors: number;
  failedAssertions: number;
  toolCalls: number;
}

interface RecentTrace extends TraceSummary {
  agentName: string;
}

interface RegressionCaseSummary {
  id: string;
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

interface GateSummary {
  id: string;
  version: string;
  baselineVersion: string | null;
  status: "running" | "pass" | "fail" | "error";
  total: number;
  passed: number;
  failed: number;
  errors: number;
  regressions: number;
  createdAt: number;
  completedAt: number | null;
}

interface DatasetSummary {
  id: string;
  name: string;
  version: string;
  checksum: string;
  itemCount: number;
}

interface SuiteSummary {
  id: string;
  name: string;
  version: string;
  datasetVersionId: string;
  datasetChecksum: string;
  agentId: string | null;
}

const EMPTY_OBSERVABILITY: ObservabilityStats = {
  total: 0,
  last24h: 0,
  errors: 0,
  failedAssertions: 0,
  toolCalls: 0,
};

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
  const [observability, setObservability] = useState<ObservabilityStats>(EMPTY_OBSERVABILITY);
  const [recentTraces, setRecentTraces] = useState<RecentTrace[]>([]);
  const [regressionCases, setRegressionCases] = useState<RegressionCaseSummary[]>([]);
  const [replayingCase, setReplayingCase] = useState<string | null>(null);
  const [gates, setGates] = useState<GateSummary[]>([]);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [suites, setSuites] = useState<SuiteSummary[]>([]);
  const [runningGate, setRunningGate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | "all" | null>(null);
  const [suite, setSuite] = useState<TestSuite>("balanced");
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      if (!response.ok) throw new Error("no se pudo leer el dashboard");
      const json: unknown = await response.json();
      if (!isDashboardPayload(json)) throw new Error("respuesta inválida del dashboard");
      setRows(json.agents);
      setObservability(isObservabilityStats(json.observability) ? json.observability : EMPTY_OBSERVABILITY);
      await Promise.all([loadRecentTraces(), loadRegressionCases(), loadGates(), loadCatalog()]);
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "no se pudo leer el dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentTraces() {
    const response = await fetch("/api/traces?limit=12", { cache: "no-store" });
    if (!response.ok) return;
    const json: unknown = await response.json();
    if (isRecentTracesPayload(json)) setRecentTraces(json.traces);
  }

  async function loadRegressionCases() {
    const response = await fetch("/api/cases", { cache: "no-store" });
    if (!response.ok) return;
    const json: unknown = await response.json();
    if (isRegressionCasesPayload(json)) setRegressionCases(json.cases);
  }

  async function loadGates() {
    const response = await fetch("/api/gates", { cache: "no-store" });
    if (!response.ok) return;
    const json: unknown = await response.json();
    if (isGatesPayload(json)) setGates(json.gates);
  }

  async function loadCatalog() {
    const [datasetResponse, suiteResponse] = await Promise.all([fetch("/api/datasets", { cache: "no-store" }), fetch("/api/suites", { cache: "no-store" })]);
    if (datasetResponse.ok) {
      const json: unknown = await datasetResponse.json();
      if (isDatasetPayload(json)) setDatasets(json.datasets);
    }
    if (suiteResponse.ok) {
      const json: unknown = await suiteResponse.json();
      if (isSuitePayload(json)) setSuites(json.suites);
    }
  }

  async function runGate() {
    setRunningGate(true);
    setNotice(null);
    try {
      const response = await fetch("/api/gates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: `local-${Date.now()}`, concurrency: 4 }),
      });
      const json = (await response.json()) as { error?: string; status?: GateSummary["status"] | "queued"; passed?: number; total?: number; regressions?: number; gateRunId?: string };
      if (!response.ok) throw new Error(json.error ?? "no se pudo ejecutar el gate");
      if (response.status === 202 && json.gateRunId) {
        setNotice("Gate en cola durable · esperando worker…");
        await waitForGate(json.gateRunId);
      } else {
        setNotice(`Gate ${json.status} · ${json.passed ?? 0}/${json.total ?? 0} pass · ${json.regressions ?? 0} regresiones`);
      }
      await loadGates();
      await loadRegressionCases();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "no se pudo ejecutar el gate");
    } finally {
      setRunningGate(false);
    }
  }

  async function waitForGate(gateRunId: string) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const response = await fetch("/api/gates", { cache: "no-store" });
      if (!response.ok) continue;
      const json: unknown = await response.json();
      if (!isGatesPayload(json)) continue;
      const gate = json.gates.find((item) => item.id === gateRunId);
      if (gate && gate.status !== "running") {
        setNotice(`Gate ${gate.status} · ${gate.passed}/${gate.total} pass · ${gate.regressions} regresiones`);
        return;
      }
    }
    setNotice("Gate sigue en ejecución; podés dejar esta pestaña y volver a consultar el historial.");
  }

  async function promoteTrace(trace: RecentTrace) {
    setNotice(null);
    try {
      const response = await fetch("/api/cases/from-trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: trace.agentId, traceId: trace.traceId }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "no se pudo crear el caso");
      setNotice("Caso de regresión guardado · listo para replay");
      await loadRegressionCases();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "no se pudo crear el caso");
    }
  }

  async function replayCase(caseId: string) {
    setReplayingCase(caseId);
    setNotice(null);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/replay`, { method: "POST" });
      const json = (await response.json()) as { error?: string; replay?: { passed: boolean } };
      if (!response.ok) throw new Error(json.error ?? "no se pudo reejecutar el caso");
      setNotice(json.replay?.passed ? "Replay pass · el comportamiento sigue cubierto" : "Replay fail · regresión detectada");
      await loadRegressionCases();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "no se pudo reejecutar el caso");
    } finally {
      setReplayingCase(null);
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
        body: JSON.stringify({ scenarioCount: 10, k: 1, suite }),
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
        body: JSON.stringify({ scenarioCount: 10, k: 1, suite }),
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

      <section className="pt-14">
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
        <div className="mt-8 flex flex-col gap-5 border-y py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="label shrink-0" style={{ color: "var(--color-signal)" }}>suite activa</div>
            <select value={suite} onChange={(event) => setSuite(event.target.value as TestSuite)} className="w-full border bg-[var(--color-panel)] px-3 py-2 text-xs uppercase tracking-widest outline-none transition-colors focus:border-[var(--color-signal)] sm:w-auto" aria-label="suite de tests">
              {(Object.keys(SUITE_DEFINITIONS) as TestSuite[]).map((key) => <option key={key} value={key}>{SUITE_DEFINITIONS[key].label}</option>)}
            </select>
            <div className="max-w-xl text-xs leading-relaxed" style={{ color: "var(--color-ink-faint)" }}>{SUITE_DEFINITIONS[suite].description}</div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button variant="ghost" onClick={() => setFormOpen((open) => !open)}>
              {formOpen ? "cerrar" : "+ registrar agent"}
            </Button>
            <Button onClick={() => void runAll()} disabled={running !== null || metrics.active === 0}>
              {running === "all" ? "iniciando…" : "correr todos →"}
            </Button>
          </div>
        </div>
      </section>

      {notice ? (
        <div className="mt-8 border px-4 py-3 text-xs" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }} role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}

      <section className="mt-12 grid grid-cols-2 gap-px border sm:grid-cols-4 lg:grid-cols-9" style={{ borderColor: "var(--color-line-bright)" }}>
        <Metric value={metrics.average === null ? "—" : `${metrics.average}%`} label="promedio último" tone="signal" />
        <Metric value={metrics.certified} label="certificados" tone="signal" />
        <Metric value={metrics.total} label="agentes" />
        <Metric value={metrics.active} label="activos" />
        <Metric value={metrics.completed} label="completados" />
        <Metric value={metrics.queued} label="en cola" tone="warn" />
        <Metric value={metrics.running} label="corriendo" tone="warn" />
        <Metric value={observability.last24h} label="traces / 24h" tone="signal" />
        <Metric value={observability.errors + observability.failedAssertions} label="señales fallidas" tone={observability.errors + observability.failedAssertions > 0 ? "warn" : "default"} />
      </section>

      <ObservedFeed traces={recentTraces} onPromote={promoteTrace} />
      <ControlPlaneCatalog datasets={datasets} suites={suites} />
      <RegressionCases cases={regressionCases} replayingCase={replayingCase} onReplay={(id) => void replayCase(id)} />
      <GatePanel gates={gates} running={runningGate} onRun={() => void runGate()} />

      {formOpen ? <AgentForm form={form} setForm={setForm} saving={saving} onSubmit={register} /> : null}

      <section className="mt-12">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="label">fleet / {rows.length.toString().padStart(2, "0")} targets</div>
            <p className="mt-2 text-xs" style={{ color: "var(--color-ink-faint)" }}>última señal por endpoint · {observability.total} traces retenidas · delta contra la suite anterior</p>
          </div>
          {hasActiveRuns ? <div className="label blink" style={{ color: "var(--color-warn)" }}>● polling live</div> : null}
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

function ControlPlaneCatalog({ datasets, suites }: { datasets: DatasetSummary[]; suites: SuiteSummary[] }) {
  const latestDataset = datasets[0];
  const latestSuite = suites[0];
  return (
    <section className="mt-12">
      <div className="mb-5 flex items-end justify-between gap-3"><div><div className="label" style={{ color: "var(--color-signal)" }}>reproducibility catalog</div><p className="mt-2 text-xs" style={{ color: "var(--color-ink-faint)" }}>datasets inmutables · suites versionadas · checksums auditables</p></div><span className="label">{datasets.length} datasets · {suites.length} suites</span></div>
      <div className="grid gap-px border sm:grid-cols-2" style={{ borderColor: "var(--color-line-bright)" }}>
        <div className="bg-[var(--color-panel)] p-5"><div className="label">último dataset</div><div className="mt-3 font-display text-xl font-800">{latestDataset ? `${latestDataset.name} / ${latestDataset.version}` : "sin versiones"}</div><div className="mt-2 text-xs" style={{ color: "var(--color-ink-faint)" }}>{latestDataset ? `${latestDataset.itemCount} casos · sha256 ${latestDataset.checksum.slice(0, 12)}…` : "Subí una versión por API, SDK o MCP."}</div></div>
        <div className="bg-[var(--color-panel)] p-5"><div className="label">última suite</div><div className="mt-3 font-display text-xl font-800">{latestSuite ? `${latestSuite.name} / ${latestSuite.version}` : "sin suites"}</div><div className="mt-2 text-xs" style={{ color: "var(--color-ink-faint)" }}>{latestSuite ? `dataset sha256 ${latestSuite.datasetChecksum.slice(0, 12)}…` : "Una suite fija la selección reproducible."}</div></div>
      </div>
    </section>
  );
}

function Metric({ value, label, tone = "default" }: { value: number | string; label: string; tone?: "default" | "warn" | "signal" }) {
  const color = tone === "warn" ? "var(--color-warn)" : tone === "signal" ? "var(--color-signal)" : "var(--color-ink)";
  return <div className="bg-[var(--color-panel)] p-5"><div className="font-display text-2xl font-800" style={{ color }}>{value}</div><div className="label mt-1 normal-case tracking-normal">{label}</div></div>;
}

function AgentCard({ row, busy, onRun }: { row: AgentRow; busy: boolean; onRun: () => void }) {
  const latest = row.latestRun;
  const latestTrace = row.latestTrace;
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
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="label truncate normal-case tracking-normal">{row.agent.clientName ?? "sin cliente"} · {row.agent.protocol} · {row.agent.mode ?? "auto"}</div>
            <SourceBadge source={row.agent.source} canRun={row.agent.canRun} />
          </div>
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
          <ScoreDelta delta={row.scoreDelta} />
        </div>
      </div>
      <div className="mt-7 flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <ScoreSparkline history={row.history} />
          <div className="mt-2 flex items-center justify-between gap-3 text-xs" style={{ color: statusColor }}>
            <span>{statusLabel} · {latest?.suite ? suiteLabel(latest.suite) : "suite legacy"}</span>
            <span style={{ color: "var(--color-ink-faint)" }}>{latest ? formatAge(latest.createdAt) : "listo para medir"}</span>
          </div>
          {latestTrace ? <div className="mt-2 text-xs" style={{ color: latestTrace.status === "error" ? "var(--color-fail)" : "var(--color-signal)" }}>trace {latestTrace.kind} · {formatAge(latestTrace.occurredAt)}{latestTrace.version ? ` · ${latestTrace.version.slice(0, 8)}` : ""}</div> : null}
        </div>
        <Button variant="ghost" onClick={onRun} disabled={busy || !row.agent.active || !row.agent.canRun}>
          {busy ? "…" : row.agent.canRun ? "eval 10×1" : "observed"}
        </Button>
      </div>
      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 border-t pt-4 text-xs" style={{ color: "var(--color-ink-faint)" }}>
        <span>{row.history.length} corridas visibles</span>
        <span>{row.agent.toolCount} tools</span>
        <span>{row.agent.authConfigured ? "auth ok" : "sin auth"}</span>
        <span>{row.scoreDelta === null ? "baseline pendiente" : "misma suite"}</span>
      </div>
    </Panel>
  );
}

function SourceBadge({ source, canRun }: { source: AgentRow["agent"]["source"]; canRun: boolean }) {
  const label = canRun && source !== "manual" ? "hybrid" : canRun ? "black-box" : "observed";
  return <span className="border px-2 py-1 text-[0.6rem] uppercase tracking-widest" style={{ borderColor: canRun ? "var(--color-line-bright)" : "var(--color-warn)", color: canRun ? "var(--color-ink-faint)" : "var(--color-warn)" }}>{label}</span>;
}

function ScoreDelta({ delta }: { delta: number | null }) {
  if (delta === null) return <div className="label mt-2">baseline pendiente</div>;
  return <div className="mt-2 text-xs font-semibold" style={{ color: delta >= 0 ? "var(--color-signal)" : "var(--color-fail)" }}>{formatDelta(delta)} vs prev</div>;
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
  return (
    <section className="mt-20 grid gap-8 border-t pt-10 lg:grid-cols-[0.7fr_1.3fr]" style={{ borderColor: "var(--color-line-bright)" }}>
      <div>
        <div className="label" style={{ color: "var(--color-signal)" }}>technical edge</div>
        <h2 className="font-display mt-3 max-w-xs text-2xl font-800 leading-tight">La señal se puede auditar.</h2>
      </div>
      <div className="divide-y border-y" style={{ borderColor: "var(--color-line-bright)" }}>
        <Edge index="01" title="Un solo engine" copy="Cada target termina en runEval: mismo profiler, escenarios, juez y certificado. La comparación no depende de una integración distinta por agente." />
        <Edge index="02" title="Backpressure real" copy="Run all persiste toda la tanda como queued y libera sólo dos ejecuciones a la vez. Evita saturar endpoints y hace visible el estado." />
        <Edge index="03" title="Datos sin maquillaje" copy="El dashboard expone score, estado, historial y errores; no muestra prompts ni tokens. La señal sale de corridas reproducibles, no de claims." />
      </div>
    </section>
  );
}

function ObservedFeed({ traces, onPromote }: { traces: RecentTrace[]; onPromote: (trace: RecentTrace) => void }) {
  return (
    <section className="mt-12">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <div className="label" style={{ color: "var(--color-signal)" }}>observed feed</div>
          <p className="mt-2 text-xs" style={{ color: "var(--color-ink-faint)" }}>evidencia reciente de agentes instrumentados · payloads sensibles omitidos</p>
        </div>
        <span className="label">{traces.length.toString().padStart(2, "0")} eventos</span>
      </div>
      <div className="overflow-x-auto border" style={{ borderColor: "var(--color-line-bright)" }}>
        {traces.length === 0 ? <div className="p-6 text-xs" style={{ color: "var(--color-ink-faint)" }}>sin traces observadas todavía</div> : (
          <div className="min-w-[42rem] divide-y" style={{ borderColor: "var(--color-line-bright)" }}>
            {traces.map((trace) => <ObservedRow key={trace.eventId} trace={trace} onPromote={onPromote} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function ObservedRow({ trace, onPromote }: { trace: RecentTrace; onPromote: (trace: RecentTrace) => void }) {
  const failed = trace.status === "error" || trace.assertion?.passed === false;
  return (
    <div className="grid grid-cols-[1.4fr_0.8fr_1fr_1fr_auto_auto] items-center gap-4 px-4 py-3 text-xs">
      <div className="truncate font-medium">{trace.agentName}</div>
      <div className="label normal-case tracking-normal">{trace.kind}{trace.toolName ? ` · ${trace.toolName}` : ""}</div>
      <div className="truncate" style={{ color: failed ? "var(--color-fail)" : "var(--color-ink-dim)" }}>{trace.assertion ? `${trace.assertion.name} · ${trace.assertion.passed ? "pass" : "fail"}` : trace.status ?? "sin estado"}</div>
      <div className="truncate font-mono text-[0.65rem]" style={{ color: "var(--color-ink-faint)" }}>{trace.version ?? trace.deployment ?? "local"}</div>
      <div className="label whitespace-nowrap normal-case tracking-normal">{formatAge(trace.occurredAt)}</div>
      {trace.assertion ? <button onClick={() => onPromote(trace)} className="label whitespace-nowrap text-left transition-colors hover:text-[var(--color-signal)]">+ caso</button> : <span />}
    </div>
  );
}

function RegressionCases({
  cases,
  replayingCase,
  onReplay,
}: {
  cases: RegressionCaseSummary[];
  replayingCase: string | null;
  onReplay: (caseId: string) => void;
}) {
  return (
    <section className="mt-12">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <div className="label" style={{ color: "var(--color-signal)" }}>regression cases</div>
          <p className="mt-2 text-xs" style={{ color: "var(--color-ink-faint)" }}>traces observadas convertidas en contratos reproducibles</p>
        </div>
        <span className="label">{cases.length.toString().padStart(2, "0")} casos</span>
      </div>
      <div className="overflow-x-auto border" style={{ borderColor: "var(--color-line-bright)" }}>
        {cases.length === 0 ? <div className="p-6 text-xs" style={{ color: "var(--color-ink-faint)" }}>promové una trace con assertion para crear el primer caso</div> : (
          <div className="min-w-[42rem] divide-y" style={{ borderColor: "var(--color-line-bright)" }}>
            {cases.map((regressionCase) => (
              <div key={regressionCase.id} className="grid grid-cols-[1.5fr_1fr_auto_auto] items-center gap-4 px-4 py-3 text-xs">
                <div className="truncate font-medium">{regressionCase.name}</div>
                <div className="truncate" style={{ color: "var(--color-ink-dim)" }}>{regressionCase.assertionName}</div>
                <div className="label" style={{ color: regressionCase.lastStatus === "fail" || regressionCase.lastStatus === "error" ? "var(--color-fail)" : regressionCase.lastStatus === "pass" ? "var(--color-signal)" : "var(--color-ink-faint)" }}>{regressionCase.lastStatus ?? "sin replay"}</div>
                <button onClick={() => onReplay(regressionCase.id)} disabled={replayingCase !== null} className="label whitespace-nowrap transition-colors hover:text-[var(--color-signal)]">{replayingCase === regressionCase.id ? "replaying…" : "replay →"}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function GatePanel({ gates, running, onRun }: { gates: GateSummary[]; running: boolean; onRun: () => void }) {
  const latest = gates[0];
  return (
    <section className="mt-12 border-t pt-10" style={{ borderColor: "var(--color-line-bright)" }}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="label" style={{ color: "var(--color-signal)" }}>ci regression gate</div>
          <h2 className="font-display mt-3 text-2xl font-800">¿Sigue pasando la flota?</h2>
          <p className="mt-2 max-w-xl text-xs leading-relaxed" style={{ color: "var(--color-ink-faint)" }}>Corre todos los casos guardados con concurrencia acotada y compara contra el último gate completado.</p>
        </div>
        <Button onClick={onRun} disabled={running || gates.some((gate) => gate.status === "running")}>{running ? "corriendo gate…" : "correr gate →"}</Button>
      </div>
      {latest ? <div className="mt-6 grid grid-cols-2 gap-px border sm:grid-cols-5" style={{ borderColor: "var(--color-line-bright)" }}>
        <Metric value={latest.status} label="último estado" tone={latest.status === "pass" ? "signal" : "warn"} />
        <Metric value={`${latest.passed}/${latest.total}`} label="casos pass" tone="signal" />
        <Metric value={latest.failed} label="fallas" tone={latest.failed > 0 ? "warn" : "default"} />
        <Metric value={latest.errors} label="errores" tone={latest.errors > 0 ? "warn" : "default"} />
        <Metric value={latest.baselineVersion ?? "—"} label="baseline" />
      </div> : <div className="mt-6 border p-5 text-xs" style={{ borderColor: "var(--color-line-bright)", color: "var(--color-ink-faint)" }}>todavía no hay un gate completado</div>}
    </section>
  );
}

function Edge({ index, title, copy }: { index: string; title: string; copy: string }) {
  return <article className="grid gap-4 py-5 sm:grid-cols-[2rem_1fr] sm:gap-5"><div className="font-mono text-xs" style={{ color: "var(--color-signal)" }}>{index}</div><div><h3 className="font-display text-lg font-800">{title}</h3><p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>{copy}</p></div></article>;
}

function formatAge(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

function suiteLabel(suite: TestSuite): string {
  return SUITE_DEFINITIONS[suite].label;
}

function formatDelta(delta: number): string {
  const points = Math.round(delta * 100);
  return `${points >= 0 ? "+" : ""}${points} pts`;
}

function isDashboardPayload(value: unknown): value is { agents: AgentRow[]; observability?: ObservabilityStats } {
  return typeof value === "object" && value !== null && Array.isArray((value as { agents?: unknown }).agents);
}

function isObservabilityStats(value: unknown): value is ObservabilityStats {
  if (typeof value !== "object" || value === null) return false;
  const stats = value as Record<string, unknown>;
  return ["total", "last24h", "errors", "failedAssertions", "toolCalls"].every(
    (key) => typeof stats[key] === "number" && Number.isFinite(stats[key]),
  );
}

function isRecentTracesPayload(value: unknown): value is { traces: RecentTrace[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { traces?: unknown }).traces);
}

function isRegressionCasesPayload(value: unknown): value is { cases: RegressionCaseSummary[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { cases?: unknown }).cases);
}

function isGatesPayload(value: unknown): value is { gates: GateSummary[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { gates?: unknown }).gates);
}

function isDatasetPayload(value: unknown): value is { datasets: DatasetSummary[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { datasets?: unknown }).datasets);
}

function isSuitePayload(value: unknown): value is { suites: SuiteSummary[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { suites?: unknown }).suites);
}
