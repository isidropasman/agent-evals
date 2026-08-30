"use client";

import { useEffect, useState } from "react";
import { Button, TextInput } from "./ui";

interface KeyStatus {
  configured: boolean;
  source: "env" | "stored" | null;
  masked: string | null;
}

type Settings = { anthropic: KeyStatus; openai: KeyStatus };

const EMPTY: KeyStatus = { configured: false, source: null, masked: null };

/**
 * The engine is useless without an Anthropic key, and before this the only way
 * to supply one was a shell export — which put a terminal between a normal
 * person and their first run. Keys can now be pasted here and are stored
 * locally; an env var still wins so existing setups don't change behaviour.
 */
export function HealthBanner() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: Settings) => {
        if (!active) return;
        setSettings(d);
        if (!d.anthropic.configured) setOpen(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!settings) return null;

  const ready = settings.anthropic.configured;
  const crossFamily = settings.openai.configured;

  return (
    <div
      className="mt-4 border text-xs"
      style={{
        borderColor: ready ? "var(--color-line-bright)" : "var(--color-warn)",
        color: ready ? "var(--color-ink-dim)" : "var(--color-warn)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              background: ready ? "var(--color-signal)" : "var(--color-warn)",
            }}
          />
          {ready ? (
            <span>
              Motor listo · juez{" "}
              {crossFamily ? (
                <strong style={{ color: "var(--color-signal)" }}>cross-family</strong>
              ) : (
                <strong style={{ color: "var(--color-warn)" }}>misma familia</strong>
              )}
            </span>
          ) : (
            <span>
              Falta la API key de Anthropic — el motor no puede generar
              escenarios ni evaluar hasta configurarla.
            </span>
          )}
        </span>
        <span className="label">{open ? "cerrar" : "configurar"}</span>
      </button>

      {open ? (
        <div className="grid gap-5 border-t px-4 py-5" style={{ borderColor: "var(--color-line)" }}>
          <KeyRow
            provider="anthropic"
            label="Anthropic API key"
            hint="Obligatoria. Genera los escenarios, simula los usuarios y propone los fixes. Se guarda en la base local de esta máquina."
            status={settings.anthropic}
            onSaved={(s) => setSettings({ ...settings, anthropic: s })}
          />
          <KeyRow
            provider="openai"
            label="OpenAI API key"
            hint="Opcional pero recomendada: mueve el juez a otra familia de modelos y elimina el self-preference bias (un modelo tiende a aprobar respuestas de su propia familia)."
            status={settings.openai}
            onSaved={(s) => setSettings({ ...settings, openai: s })}
          />
        </div>
      ) : null}
    </div>
  );
}

function KeyRow({
  provider,
  label,
  hint,
  status,
  onSaved,
}: {
  provider: "anthropic" | "openai";
  label: string;
  hint: string;
  status: KeyStatus;
  onSaved: (s: KeyStatus) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey: next }),
      });
      const data = (await res.json()) as Record<string, KeyStatus> & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar la key");
        return;
      }
      onSaved(data[provider] ?? EMPTY);
      setValue("");
    } catch {
      setError("No se pudo guardar la key");
    } finally {
      setBusy(false);
    }
  }

  const fromEnv = status.source === "env";

  return (
    <div>
      <div className="label mb-2">{label}</div>
      {status.configured ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs" style={{ color: "var(--color-signal)" }}>
            {status.masked}
          </span>
          <span className="label normal-case tracking-normal">
            {fromEnv ? "desde variable de entorno" : "guardada localmente"}
          </span>
          {fromEnv ? null : (
            <Button variant="ghost" disabled={busy} onClick={() => void save("")}>
              borrar
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[260px] flex-1">
            <TextInput
              type="password"
              value={value}
              placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button disabled={busy || value.trim().length === 0} onClick={() => void save(value)}>
            {busy ? "guardando" : "guardar"}
          </Button>
        </div>
      )}
      <p className="mt-1.5 leading-relaxed" style={{ color: "var(--color-ink-faint)" }}>
        {hint}
      </p>
      {error ? (
        <p className="mt-1.5" style={{ color: "var(--color-fail)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
