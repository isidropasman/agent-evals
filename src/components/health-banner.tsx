"use client";

import { useEffect, useState } from "react";

export function HealthBanner() {
  const [warn, setWarn] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { anthropicConfigured?: boolean }) => {
        if (!active) return;
        if (!d.anthropicConfigured) {
          setWarn(
            "Falta ANTHROPIC_API_KEY en el entorno. Los agentes se conectan igual, pero el motor de evals no puede generar escenarios ni evaluar hasta configurarla.",
          );
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!warn) return null;
  return (
    <div
      className="mt-4 flex items-start gap-3 border px-4 py-3 text-xs leading-relaxed"
      style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}
    >
      <span className="mt-px">⚠</span>
      <span>{warn}</span>
    </div>
  );
}
