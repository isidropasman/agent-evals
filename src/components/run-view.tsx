"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  RunProgress,
  RunReport,
  ScenarioCategory,
  ScenarioResult,
} from "@/engine/types";
import { Corner, Panel } from "./ui";

interface RunData {
  id: string;
  agentName: string;
  clientName: string | null;
  status: "running" | "done" | "error";
  progress: RunProgress | null;
  report: RunReport | null;
  error: string | null;
}

const CAT_LABEL: Record<ScenarioCategory, string> = {
  happy_path: "Happy path",
  edge_case: "Edge cases",
  adversarial: "Adversarial",
};

export function RunView({ runId }: { runId: string }) {
  const [data, setData] = useState<RunData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (!res.ok) {
          setFetchError("No se encontró la corrida");
          return;
        }
        const json = (await res.json()) as RunData;
        if (!active) return;
        setData(json);
        if (json.status === "running") {
          timer = setTimeout(poll, 1500);
        }
      } catch {
        if (active) timer = setTimeout(poll, 3000);
      }
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [runId]);

  return (
    <main className="content mx-auto max-w-6xl px-6 pb-32">
      <header className="flex items-center justify-between border-b py-5">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="font-display text-xl font-900 tracking-tight">GAUNTLET</span>
          <span className="label">/ {data?.agentName ?? "corrida"}</span>
        </Link>
        <span className="label">{runId.slice(0, 8)}</span>
      </header>

      {fetchError && <Notice tone="fail">{fetchError}</Notice>}
      {data?.status === "error" && <Notice tone="fail">Falló: {data.error}</Notice>}

      {data?.status === "running" && (
        <RunningView progress={data.progress} runId={runId} />
      )}

      {data?.status === "done" && data.report && (
        <ResultsView runId={runId} report={data.report} clientName={data.clientName} />
      )}

      {!data && !fetchError && <RunningView progress={null} runId={runId} />}
    </main>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone: "fail" }) {
  return (
    <div
      className="mt-6 border px-4 py-3 text-sm"
      style={{ borderColor: `var(--color-${tone})`, color: `var(--color-${tone})` }}
    >
      {children}
    </div>
  );
}

function RunningView({
  progress,
  runId,
}: {
  progress: RunProgress | null;
  runId: string;
}) {
  const [cancelling, setCancelling] = useState(false);
  const pct = progress && progress.totalConversations > 0
    ? Math.round((progress.completedConversations / progress.totalConversations) * 100)
    : 0;

  async function cancel() {
    setCancelling(true);
    await fetch(`/api/runs/${runId}/cancel`, { method: "POST" }).catch(() => {});
  }
  const phaseLabel: Record<RunProgress["phase"], string> = {
    generating: "Generando escenarios",
    simulating: "Simulando conversaciones",
    judging: "Evaluando",
    fixing: "Proponiendo fixes",
    done: "Listo",
    error: "Error",
  };

  return (
    <div className="pt-16">
      <Panel className="relative overflow-hidden p-10">
        <Corner />
        <div className="scanning absolute inset-x-0 top-0 h-px" />
        <div className="label mb-4">
          <span className="blink" style={{ color: "var(--color-signal)" }}>●</span>{" "}
          en ejecución
        </div>
        <h2 className="font-display text-4xl font-800">
          {progress ? phaseLabel[progress.phase] : "Iniciando"}
        </h2>
        <p className="mt-3 h-5 text-sm" style={{ color: "var(--color-ink-dim)" }}>
          {progress?.message ?? "Levantando la corrida…"}
        </p>

        <div className="mt-10">
          <div className="mb-2 flex justify-between text-xs" style={{ color: "var(--color-ink-faint)" }}>
            <span>
              {progress?.completedConversations ?? 0} / {progress?.totalConversations ?? "—"} conversaciones
            </span>
            <span style={{ color: "var(--color-signal)" }}>{pct}%</span>
          </div>
          <div className="h-2 border" style={{ borderColor: "var(--color-line-bright)" }}>
            <div
              className="h-full transition-all duration-500"
              style={{ width: `${pct}%`, background: "var(--color-signal)" }}
            />
          </div>
        </div>

        <div className="mt-8">
          <button
            onClick={cancel}
            disabled={cancelling}
            className="border px-4 py-2 text-xs font-semibold uppercase tracking-widest transition-colors hover:border-[var(--color-fail)] hover:text-[var(--color-fail)] disabled:opacity-40"
          >
            {cancelling ? "cancelando…" : "cancelar corrida"}
          </button>
        </div>
      </Panel>
    </div>
  );
}

function ResultsView({
  runId,
  report,
  clientName,
}: {
  runId: string;
  report: RunReport;
  clientName: string | null;
}) {
  const scorePct = Math.round(report.score * 100);
  const passed = report.certified;

  return (
    <div className="pt-12">
      {/* verdict banner */}
      <div className="grid grid-cols-1 gap-px border md:grid-cols-12" style={{ borderColor: "var(--color-line-bright)" }}>
        <div className="flex flex-col justify-between bg-[var(--color-panel)] p-8 md:col-span-5">
          <div className="label">veredicto</div>
          <div className="my-6">
            <div
              className="font-display text-7xl font-900 leading-none"
              style={{ color: passed ? "var(--color-signal)" : "var(--color-fail)" }}
            >
              {scorePct}
              <span className="text-3xl">/100</span>
            </div>
            <div
              className="mt-3 inline-block px-3 py-1 text-xs font-bold uppercase tracking-widest"
              style={{
                background: passed ? "var(--color-signal)" : "var(--color-fail)",
                color: "var(--color-void)",
              }}
            >
              {passed ? "certificable" : "no pasa el gate"}
            </div>
          </div>
          <div className="text-xs" style={{ color: "var(--color-ink-dim)" }}>
            {report.totals.passed}/{report.totals.scenarios} escenarios ·{" "}
            {report.totals.conversations} conversaciones · pass^k
          </div>
        </div>

        <div className="grid grid-cols-1 gap-px bg-[var(--color-line-bright)] md:col-span-7">
          {report.categories.map((c) => (
            <div key={c.category} className="bg-[var(--color-panel)] p-6">
              <div className="flex items-center justify-between">
                <span className="label normal-case tracking-normal">{CAT_LABEL[c.category]}</span>
                <span className="font-mono text-sm" style={{ color: "var(--color-ink-dim)" }}>
                  {c.passed}/{c.total}
                </span>
              </div>
              <div className="mt-3 h-1.5" style={{ background: "var(--color-line-bright)" }}>
                <div
                  className="h-full"
                  style={{
                    width: `${Math.round(c.rate * 100)}%`,
                    background: c.rate >= 0.8 ? "var(--color-signal)" : c.rate >= 0.5 ? "var(--color-warn)" : "var(--color-fail)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {report.judgeFamilyDisclaimer && (
        <p className="mt-4 text-xs" style={{ color: "var(--color-warn)" }}>
          ⚠ {report.judgeFamilyDisclaimer}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {passed && (
          <Link
            href={`/runs/${runId}/certificate`}
            className="inline-flex items-center gap-2 bg-[var(--color-signal)] px-5 py-3 text-sm font-semibold uppercase tracking-widest text-[var(--color-void)] transition-all hover:-translate-y-px hover:brightness-110"
          >
            ver certificado →
          </Link>
        )}
        <Link
          href="/"
          className="inline-flex items-center gap-2 border px-5 py-3 text-sm font-semibold uppercase tracking-widest transition-colors hover:border-[var(--color-signal)] hover:text-[var(--color-signal)]"
        >
          nueva corrida
        </Link>
      </div>

      {/* fixes */}
      {report.fixes.length > 0 && (
        <section className="mt-16">
          <div className="label mb-5">fixes sugeridos · {report.fixes.length}</div>
          <div className="space-y-4">
            {report.fixes.map((fix, i) => (
              <Panel key={i} className="p-6">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <p className="text-sm font-semibold">{fix.problem}</p>
                  <span className="label shrink-0">{fix.scenarioIds.length} escenarios</span>
                </div>
                <pre
                  className="overflow-x-auto border bg-[var(--color-void)] p-4 text-xs leading-relaxed"
                  style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
                >
                  {fix.diff}
                </pre>
                <p className="mt-3 text-xs" style={{ color: "var(--color-ink-faint)" }}>
                  {fix.rationale}
                </p>
              </Panel>
            ))}
          </div>
        </section>
      )}

      {/* failure explorer */}
      <FailureExplorer results={report.scenarioResults} />
    </div>
  );
}

function FailureExplorer({ results }: { results: ScenarioResult[] }) {
  const [filter, setFilter] = useState<"failed" | "all">("failed");
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(
    () => (filter === "failed" ? results.filter((r) => !r.passK) : results),
    [results, filter],
  );

  return (
    <section className="mt-16">
      <div className="mb-5 flex items-center justify-between">
        <div className="label">explorador de escenarios</div>
        <div className="flex border" style={{ borderColor: "var(--color-line-bright)" }}>
          {(["failed", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
              style={{
                background: filter === f ? "var(--color-signal)" : "transparent",
                color: filter === f ? "var(--color-void)" : "var(--color-ink-dim)",
              }}
            >
              {f === "failed" ? "fallidos" : "todos"}
            </button>
          ))}
        </div>
      </div>

      <div className="border" style={{ borderColor: "var(--color-line-bright)" }}>
        {shown.length === 0 && (
          <div className="p-6 text-sm" style={{ color: "var(--color-ink-dim)" }}>
            Sin escenarios fallidos. 🟢
          </div>
        )}
        {shown.map((r) => {
          const isOpen = open === r.scenario.id;
          const failed = r.attempts.find((a) => !a.verdict.pass) ?? r.attempts[0];
          return (
            <div key={r.scenario.id} className="border-b last:border-b-0">
              <button
                onClick={() => setOpen(isOpen ? null : r.scenario.id)}
                className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-[var(--color-panel-2)]"
              >
                <span
                  className="h-2 w-2 shrink-0"
                  style={{ background: r.passK ? "var(--color-signal)" : "var(--color-fail)" }}
                />
                <span className="font-mono text-xs" style={{ color: "var(--color-ink-faint)" }}>
                  {r.scenario.id}
                </span>
                <span className="flex-1 truncate text-sm">{r.scenario.title}</span>
                <span className="label shrink-0 normal-case tracking-normal">
                  {r.attempts.filter((a) => a.verdict.pass).length}/{r.attempts.length} ✓
                </span>
                <span style={{ color: "var(--color-ink-faint)" }}>{isOpen ? "−" : "+"}</span>
              </button>

              {isOpen && failed && (
                <div className="border-t bg-[var(--color-void)] p-5">
                  <div className="mb-4 grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                    <Kv k="Persona" v={r.scenario.persona} />
                    <Kv k="Objetivo" v={r.scenario.objective} />
                    <Kv k="Criterio de éxito" v={r.scenario.successCriteria} />
                    <Kv
                      k="Criterios fallados"
                      v={failed.verdict.failedCriteria.join("; ") || "—"}
                      tone={failed.verdict.pass ? undefined : "fail"}
                    />
                  </div>
                  <div className="mb-2 label">veredicto del juez</div>
                  <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
                    {failed.verdict.rationale}
                  </p>
                  <div className="mb-2 label">transcript</div>
                  <div className="space-y-2">
                    {failed.transcript.length === 0 && (
                      <p className="text-xs" style={{ color: "var(--color-fail)" }}>
                        {failed.error ?? "La conversación no pudo completarse."}
                      </p>
                    )}
                    {failed.transcript.map((t, i) => (
                      <div
                        key={i}
                        className="border-l-2 pl-3 text-xs leading-relaxed"
                        style={{
                          borderColor: t.role === "user" ? "var(--color-line-bright)" : "var(--color-signal-deep)",
                        }}
                      >
                        <span
                          className="label normal-case"
                          style={{ color: t.role === "user" ? "var(--color-ink-faint)" : "var(--color-signal-deep)" }}
                        >
                          {t.role === "user" ? "usuario sim" : "agente"}
                        </span>
                        <p className="mt-0.5" style={{ color: "var(--color-ink-dim)" }}>{t.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Kv({ k, v, tone }: { k: string; v: string; tone?: "fail" }) {
  return (
    <div>
      <div className="label normal-case">{k}</div>
      <p className="mt-0.5" style={{ color: tone ? "var(--color-fail)" : "var(--color-ink-dim)" }}>
        {v}
      </p>
    </div>
  );
}
