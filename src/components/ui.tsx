import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border bg-[var(--color-panel)] ${className}`}
      style={{ borderColor: "var(--color-line-bright)" }}
    >
      {children}
    </div>
  );
}

export function Corner() {
  return (
    <>
      <span className="pointer-events-none absolute -left-px -top-px h-2 w-2 border-l-2 border-t-2" style={{ borderColor: "var(--color-signal)" }} />
      <span className="pointer-events-none absolute -right-px -top-px h-2 w-2 border-r-2 border-t-2" style={{ borderColor: "var(--color-signal)" }} />
      <span className="pointer-events-none absolute -bottom-px -left-px h-2 w-2 border-b-2 border-l-2" style={{ borderColor: "var(--color-signal)" }} />
      <span className="pointer-events-none absolute -bottom-px -right-px h-2 w-2 border-b-2 border-r-2" style={{ borderColor: "var(--color-signal)" }} />
    </>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  type?: "button" | "submit";
}) {
  const base =
    "relative inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-[var(--color-signal)] text-[var(--color-void)] hover:brightness-110 hover:-translate-y-px"
      : "border text-[var(--color-ink)] hover:border-[var(--color-signal)] hover:text-[var(--color-signal)]";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="label mb-2">{label}</div>
      {children}
      {hint ? (
        <p className="mt-1.5 text-xs" style={{ color: "var(--color-ink-faint)" }}>
          {hint}
        </p>
      ) : null}
    </label>
  );
}

const inputCls =
  "w-full bg-[var(--color-void)] border px-3 py-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-signal)] transition-colors placeholder:text-[var(--color-ink-faint)]";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} resize-none leading-relaxed`} />;
}
