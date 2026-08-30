import Link from "next/link";
import { Onboarding } from "@/components/onboarding";
import { HealthBanner } from "@/components/health-banner";

export default function Home() {
  return (
    <main className="content mx-auto max-w-6xl px-6 pb-32">
      <header className="flex items-center justify-between border-b py-5">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-xl font-900 tracking-tight">GAUNTLET</span>
          <span className="label">/ agent proving ground</span>
        </div>
        <nav className="flex gap-6">
          <Link
            href="/benchmark"
            className="label transition-colors hover:text-[var(--color-signal)]"
          >
            benchmark ↗
          </Link>
          <Link href="/runs" className="label transition-colors hover:text-[var(--color-signal)]">
            historial ↗
          </Link>
        </nav>
      </header>

      <HealthBanner />

      <section className="grid grid-cols-1 gap-10 pt-20 md:grid-cols-12">
        <div className="md:col-span-7">
          <div className="rise label mb-6" style={{ animationDelay: "0ms" }}>
            pre-production evals · black-box · cualquier agente
          </div>
          <h1
            className="rise font-display text-5xl font-900 leading-[0.95] tracking-tight md:text-7xl"
            style={{ animationDelay: "80ms" }}
          >
            Pegá la URL.
            <br />
            Lo{" "}
            <span style={{ color: "var(--color-signal)" }}>torturamos</span>.
            <br />
            Certificás.
          </h1>
          <p
            className="rise mt-8 max-w-md text-sm leading-relaxed"
            style={{ color: "var(--color-ink-dim)", animationDelay: "160ms" }}
          >
            Conectás cualquier agente por su endpoint. Generamos cientos de
            simulaciones multi-turno — happy path, edge cases, ataques — corremos
            cada una k veces, y te devolvemos qué falla, cómo arreglarlo, y un
            certificado para tu cliente cuando pasa.
          </p>

          <dl
            className="rise mt-12 grid grid-cols-3 gap-px border"
            style={{ animationDelay: "240ms", borderColor: "var(--color-line-bright)" }}
          >
            {[
              ["50", "escenarios / corrida"],
              ["pass^k", "no basta pasar una vez"],
              ["<15min", "a reporte completo"],
            ].map(([big, small]) => (
              <div key={small} className="bg-[var(--color-panel)] p-5">
                <div className="font-display text-2xl font-800" style={{ color: "var(--color-signal)" }}>
                  {big}
                </div>
                <div className="label mt-1 normal-case tracking-normal">{small}</div>
              </div>
            ))}
          </dl>
        </div>

        <div className="rise md:col-span-5" style={{ animationDelay: "320ms" }}>
          <Onboarding />
        </div>
      </section>

      <section className="mt-28 border-t pt-10">
        <div className="label mb-8">cómo funciona</div>
        <ol className="grid grid-cols-1 gap-px border md:grid-cols-4" style={{ borderColor: "var(--color-line-bright)" }}>
          {[
            ["01", "Conectar", "Endpoint OpenAI-compatible o Coval. Cero instrumentación en tu agente."],
            ["02", "Generar", "Leemos tu system prompt y armamos 50 escenarios: 20 happy / 15 edge / 15 adversarial."],
            ["03", "Correr", "Un LLM simula usuarios contra tu agente, k veces cada escenario. Un juez binario cross-family evalúa."],
            ["04", "Certificar", "Score ponderado, fixes de prompt sugeridos, y un certificado white-label."],
          ].map(([n, t, d]) => (
            <li key={n} className="bg-[var(--color-panel)] p-6">
              <div className="font-mono text-xs" style={{ color: "var(--color-signal)" }}>{n}</div>
              <div className="font-display mt-3 text-lg font-700">{t}</div>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>{d}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
