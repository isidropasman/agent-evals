import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/server/db";
import { PrintButton } from "@/components/print-button";

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

async function sha256Short(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = getRun(id);
  if (!run || !run.report) notFound();
  const report = run.report;

  const configHash = await sha256Short(
    `${run.agentName}|${run.endpointUrl}|${report.score}`,
  );
  const scorePct = Math.round(report.score * 100);

  return (
    <main className="content mx-auto max-w-4xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/runs/${id}`} className="label transition-colors hover:text-[var(--color-signal)]">
          ← volver al reporte
        </Link>
        <span className="label">certificado white-label</span>
      </div>

      <article
        className="relative overflow-hidden border-2 bg-[var(--color-panel)] p-12"
        style={{ borderColor: "var(--color-signal)" }}
      >
        {/* stamp */}
        <div className="pointer-events-none absolute right-10 top-16 hidden md:block">
          <div className="stamp px-6 py-3 font-display text-2xl font-900 uppercase tracking-widest">
            {report.certified ? "Passed" : "Reviewed"}
          </div>
        </div>

        <div className="label">certificado de evaluación · gauntlet</div>
        <h1 className="font-display mt-6 text-4xl font-900 leading-tight md:text-5xl">
          {run.agentName}
        </h1>
        {run.clientName && (
          <p className="mt-2 text-sm" style={{ color: "var(--color-ink-dim)" }}>
            Entregado a {run.clientName}
          </p>
        )}

        <div className="my-10 flex items-end gap-6 border-y py-8">
          <div>
            <div className="label mb-1">score global</div>
            <div className="font-display text-6xl font-900" style={{ color: "var(--color-signal)" }}>
              {scorePct}
              <span className="text-2xl" style={{ color: "var(--color-ink-dim)" }}>/100</span>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-3 gap-px border" style={{ borderColor: "var(--color-line-bright)" }}>
            {report.categories.map((c) => (
              <div key={c.category} className="bg-[var(--color-void)] p-4">
                <div className="label normal-case tracking-normal text-[10px]">
                  {c.category.replace("_", " ")}
                </div>
                <div className="mt-1 font-mono text-lg">
                  {Math.round(c.rate * 100)}%
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="max-w-xl text-sm leading-relaxed" style={{ color: "var(--color-ink-dim)" }}>
          Este agente fue sometido a {report.totals.conversations} conversaciones
          simuladas multi-turno ({report.totals.scenarios} escenarios evaluados con
          criterio pass^k) cubriendo happy path, edge cases y ataques adversariales.
          Juzgado de forma binaria (pass/fail) por {report.judgeModel}.
        </p>

        <div className="mt-10 grid grid-cols-2 gap-6 border-t pt-6 text-xs md:grid-cols-4" style={{ color: "var(--color-ink-faint)" }}>
          <Meta k="Emitido" v={fmtDate(run.createdAt)} />
          <Meta k="Config hash" v={configHash} />
          <Meta k="Escenarios OK" v={`${report.totals.passed}/${report.totals.scenarios}`} />
          <Meta k="Verificación" v="autoatestado" />
        </div>

        <p className="mt-6 text-[10px] leading-relaxed" style={{ color: "var(--color-ink-faint)" }}>
          Certifica la configuración declarada del agente al momento de la
          evaluación (hash arriba). No verifica que el agente desplegado en
          producción sea idéntico. Cualquier cambio posterior al system prompt o
          configuración invalida este certificado.
        </p>
      </article>

      <div className="mt-6 print:hidden">
        <PrintButton />
      </div>
    </main>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="label normal-case text-[10px]">{k}</div>
      <div className="mt-0.5 font-mono" style={{ color: "var(--color-ink)" }}>{v}</div>
    </div>
  );
}
