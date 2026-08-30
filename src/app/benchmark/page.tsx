import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { BenchResult } from "../../../bench/run";

export const dynamic = "force-dynamic";

/**
 * The benchmark is a product surface, not an internal script: the claim
 * "better than asking a chat model" is only worth anything if the numbers
 * behind it, including the ones that look bad, are visible to whoever is
 * deciding whether to trust a verdict.
 */
function loadResult(): BenchResult | null {
  try {
    const file = path.join(process.cwd(), "bench/results/latest.json");
    return JSON.parse(readFileSync(file, "utf8")) as BenchResult;
  } catch {
    return null;
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export default function BenchmarkPage() {
  const result = loadResult();

  return (
    <main className="content mx-auto max-w-5xl px-6 pb-32">
      <header className="flex items-center justify-between border-b py-5">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="font-display text-xl font-900 tracking-tight">GAUNTLET</span>
          <span className="label">/ benchmark</span>
        </Link>
        <Link href="/runs" className="label transition-colors hover:text-[var(--color-signal)]">
          historial ↗
        </Link>
      </header>

      <section className="pt-16">
        <h1 className="font-display text-4xl font-900 leading-tight tracking-tight md:text-5xl">
          ¿Encuentra más que preguntarle a un modelo?
        </h1>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
          Siete agentes de referencia con defectos <strong>plantados por nosotros</strong>: sabemos
          exactamente qué está mal en cada uno, así que «¿lo encontró?» tiene respuesta objetiva y
          no opinión. Cada defecto está clasificado según si se puede deducir leyendo el system
          prompt o si sólo aparece hablando con el agente vivo — esa distinción es la que hace
          honesta la comparación contra un modelo de chat.
        </p>
      </section>

      {result === null ? (
        <NoResults />
      ) : (
        <>
          {result.config.mock ? (
            <div
              className="mt-10 border px-4 py-3 text-xs"
              style={{ borderColor: "var(--color-fail)", color: "var(--color-fail)" }}
            >
              Estos resultados salieron de una corrida <strong>mock</strong> (proveedores
              simulados). Es una prueba del arnés, no una medición.
            </div>
          ) : null}

          <Comparison result={result} />
          <Decomposition result={result} />
          <PerFixture result={result} />

          <section className="mt-20 border-t pt-8">
            <div className="label mb-4">metodología</div>
            <ul className="grid gap-2 text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
              <li>
                · {result.config.scenarios} escenarios × k={result.config.k} por agente. Juez{" "}
                <span className="font-mono">{result.config.judgeModel}</span> (familia{" "}
                {result.config.judgeFamily}), simulador{" "}
                <span className="font-mono">{result.config.simulatorModel}</span>.
              </li>
              <li>
                · Un defecto cuenta como <strong>provocado</strong> cuando el agente de referencia
                registró que su capa defectuosa se disparó en esa conversación — no cuando alguien
                cree que se disparó.
              </li>
              <li>
                · Un defecto cuenta como <strong>hallado</strong> cuando al menos una conversación
                donde ocurrió fue marcada como fallada. Separar «provocado» de «detectado» separa
                los errores del generador de escenarios de los errores del juez.
              </li>
              <li>
                · Los brazos de comparación se califican con un evaluador estricto: una mención
                genérica de la categoría («puede alucinar») no cuenta como haber encontrado un
                defecto concreto.
              </li>
              <li>
                · El agente control no tiene defectos plantados, pero eso no lo vuelve
                infalible: cada conversación suya que el juez falla la revisa un{" "}
                <strong>adjudicador independiente</strong> (
                <span className="font-mono">{result.config.adjudicatorModel}</span>, familia{" "}
                {result.config.adjudicatorFamily} — distinta de la del juez) que sólo ve el
                transcript y el prompt del agente. Sólo cuenta como falso positivo si confirma
                que el agente no incumplió ninguna regla propia.
              </li>
              <li>
                · Límite conocido: el adjudicador es un LLM, no etiquetas humanas, y comparte
                familia con los agentes de referencia — puede ser indulgente con ellos, lo que
                empuja la tasa de falsos positivos hacia arriba. Es la cota conservadora, no la
                optimista.
              </li>
              <li>· Generado {new Date(result.generatedAt).toLocaleString("es-AR")}.</li>
            </ul>
          </section>

          {result.notes.length > 0 ? (
            <section className="mt-10">
              <div className="label mb-3">notas de la corrida</div>
              <ul className="grid gap-1 text-xs" style={{ color: "var(--color-warn)" }}>
                {result.notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

function NoResults() {
  return (
    <section className="mt-12 border px-6 py-8" style={{ borderColor: "var(--color-line-bright)" }}>
      <div className="label mb-3">sin resultados todavía</div>
      <p className="max-w-2xl text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
        El benchmark no se corrió en esta instalación. Se corre con una API key real, contra los
        siete agentes de referencia:
      </p>
      <pre
        className="mt-5 overflow-x-auto border px-4 py-3 font-mono text-xs"
        style={{ borderColor: "var(--color-line)", color: "var(--color-signal)" }}
      >
        {`export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...      # opcional: juez cross-family
pnpm bench --scenarios 12 --k 2`}
      </pre>
      <p className="mt-5 max-w-2xl text-xs leading-relaxed" style={{ color: "var(--color-ink-faint)" }}>
        Escribe <span className="font-mono">bench/results/latest.json</span> y esta página lo
        muestra. Deliberadamente no viene con resultados de fábrica: un benchmark que nadie corrió
        en su propia máquina es marketing, no evidencia.
      </p>
    </section>
  );
}

function Comparison({ result }: { result: BenchResult }) {
  return (
    <section className="mt-14">
      <div className="label mb-4">defectos encontrados, por método</div>
      <div className="grid gap-px border md:grid-cols-3" style={{ borderColor: "var(--color-line-bright)" }}>
        {result.arms.map((arm) => {
          const isGauntlet = arm.arm === "gauntlet";
          return (
            <div key={arm.arm} className="bg-[var(--color-panel)] p-6">
              <div className="label normal-case tracking-normal" style={{ minHeight: "3.5rem" }}>
                {arm.label}
              </div>
              <div
                className="font-display mt-4 text-5xl font-900"
                style={{ color: isGauntlet ? "var(--color-signal)" : "var(--color-ink-dim)" }}
              >
                {arm.defectsFound}
                <span className="text-2xl" style={{ color: "var(--color-ink-faint)" }}>
                  /{arm.defectsTotal}
                </span>
              </div>
              <dl className="mt-5 grid gap-1.5 text-xs" style={{ color: "var(--color-ink-dim)" }}>
                <div className="flex justify-between gap-3">
                  <dt>visibles en el prompt</dt>
                  <dd className="font-mono">
                    {arm.byVisibility["prompt-visible"].found}/
                    {arm.byVisibility["prompt-visible"].total}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>sólo en el comportamiento</dt>
                  <dd className="font-mono">
                    {arm.byVisibility["behavior-only"].found}/
                    {arm.byVisibility["behavior-only"].total}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-t pt-1.5" style={{ borderColor: "var(--color-line)" }}>
                  <dt>falsas alarmas</dt>
                  <dd className="font-mono">
                    {arm.falseAlarms}
                    {isGauntlet ? "%" : ""}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--color-ink-faint)" }}>
                {arm.falseAlarmUnit}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Decomposition({ result }: { result: BenchResult }) {
  const cells: [string, string, string][] = [
    [
      pct(result.metrics.elicitationRate),
      "elicitación",
      "de los defectos plantados, cuántos llegó a provocar el suite de escenarios",
    ],
    [
      result.metrics.judgeRecall === null ? "n/d" : pct(result.metrics.judgeRecall),
      "recall del juez",
      "de las conversaciones donde el defecto ocurrió de verdad, cuántas marcó como falla",
    ],
    [
      pct(result.metrics.controlFalsePositiveRate),
      "falsos positivos",
      `conversaciones del agente sano falladas donde un adjudicador independiente (${result.config.adjudicatorFamily}, distinta familia que el juez) confirmó que el agente no había incumplido nada. Antes de adjudicar: ${pct(result.metrics.controlCleanFailRate)}`,
    ],
  ];
  return (
    <section className="mt-14">
      <div className="label mb-4">de dónde viene el número</div>
      <div className="grid gap-px border md:grid-cols-3" style={{ borderColor: "var(--color-line-bright)" }}>
        {cells.map(([big, title, desc]) => (
          <div key={title} className="bg-[var(--color-panel)] p-6">
            <div className="font-display text-3xl font-800" style={{ color: "var(--color-signal)" }}>
              {big}
            </div>
            <div className="label mt-2">{title}</div>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
              {desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PerFixture({ result }: { result: BenchResult }) {
  return (
    <section className="mt-14">
      <div className="label mb-4">defecto por defecto</div>
      <div className="grid gap-px border" style={{ borderColor: "var(--color-line-bright)" }}>
        {result.gauntlet.map((score) => {
          const fixture = result.fixtures.find((f) => f.id === score.fixtureId);
          return (
            <div key={score.fixtureId} className="bg-[var(--color-panel)] p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-display text-sm font-700">{fixture?.name ?? score.fixtureId}</span>
                <span className="font-mono text-xs" style={{ color: "var(--color-ink-dim)" }}>
                  score {pct(score.score)}
                </span>
              </div>
              {score.defects.length === 0 ? (
                <p className="mt-3 text-xs" style={{ color: "var(--color-ink-dim)" }}>
                  Control sano · {score.cleanFails}/{score.cleanConversations} conversaciones
                  falladas ({pct(score.cleanFailRate)} de falsos positivos)
                </p>
              ) : (
                <ul className="mt-3 grid gap-2">
                  {score.defects.map((d) => {
                    const armRows = result.findings.filter(
                      (f) => f.fixtureId === score.fixtureId && f.defectId === d.defectId,
                    );
                    return (
                      <li key={d.defectId} className="text-xs leading-relaxed">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="px-1.5 py-0.5 font-mono text-[10px] uppercase"
                            style={{
                              background: d.found ? "var(--color-signal)" : "var(--color-fail)",
                              color: "var(--color-void)",
                            }}
                          >
                            {d.found ? "hallado" : "no hallado"}
                          </span>
                          <span className="font-mono" style={{ color: "var(--color-ink-faint)" }}>
                            {d.visibility}
                          </span>
                          <span style={{ color: "var(--color-ink-faint)" }}>
                            provocado {d.elicited}× · detectado {d.caught}×
                          </span>
                          {armRows.map((row) => (
                            <span
                              key={row.arm}
                              className="font-mono"
                              style={{
                                color: row.identified
                                  ? "var(--color-ink-dim)"
                                  : "var(--color-ink-faint)",
                              }}
                            >
                              {row.arm}: {row.identified ? "sí" : "no"}
                            </span>
                          ))}
                        </div>
                        <p className="mt-1" style={{ color: "var(--color-ink-dim)" }}>
                          {d.description}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
