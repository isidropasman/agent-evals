import Link from "next/link";
import { listRuns } from "@/server/db";

function fmt(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const runs = listRuns();
  return (
    <main className="content mx-auto max-w-5xl px-6 pb-32">
      <header className="flex items-center justify-between border-b py-5">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="font-display text-xl font-900 tracking-tight">GAUNTLET</span>
          <span className="label">/ historial</span>
        </Link>
        <Link href="/" className="label transition-colors hover:text-[var(--color-signal)]">
          + nueva corrida
        </Link>
      </header>

      <div className="mt-10 border" style={{ borderColor: "var(--color-line-bright)" }}>
        {runs.length === 0 && (
          <div className="p-8 text-sm" style={{ color: "var(--color-ink-dim)" }}>
            Sin corridas todavía. <Link href="/" className="underline">Arrancá una.</Link>
          </div>
        )}
        {runs.map((r) => (
          <Link
            key={r.id}
            href={`/runs/${r.id}`}
            className="flex items-center gap-4 border-b p-4 transition-colors last:border-b-0 hover:bg-[var(--color-panel-2)]"
          >
            <span
              className="h-2 w-2 shrink-0"
              style={{
                background:
                  r.status === "running"
                    ? "var(--color-warn)"
                    : r.status === "error"
                      ? "var(--color-fail)"
                      : r.report?.certified
                        ? "var(--color-signal)"
                        : "var(--color-ink-faint)",
              }}
            />
            <span className="flex-1 truncate text-sm">{r.agentName}</span>
            <span className="label shrink-0 normal-case tracking-normal">{fmt(r.createdAt)}</span>
            <span className="w-16 shrink-0 text-right font-mono text-sm" style={{ color: "var(--color-ink-dim)" }}>
              {r.report ? `${Math.round(r.report.score * 100)}` : r.status === "running" ? "···" : "—"}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
