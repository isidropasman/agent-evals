"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="border px-5 py-3 text-sm font-semibold uppercase tracking-widest transition-colors hover:border-[var(--color-signal)] hover:text-[var(--color-signal)]"
    >
      imprimir / guardar PDF
    </button>
  );
}
