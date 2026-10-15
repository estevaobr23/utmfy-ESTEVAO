"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
      className="inline-flex items-center rounded-md bg-surface-hover px-2.5 py-1 text-xs font-medium text-copy ring-1 ring-input-border hover:bg-surface"
    >
      {done ? "Copiado ✓" : label}
    </button>
  );
}

export function SubmitButton({ children, variant = "primary", pendingText = "Processando...", disabled = false }: { children: React.ReactNode; variant?: "primary" | "secondary" | "danger"; pendingText?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary" ? "bg-primary text-white hover:bg-[var(--primary-hover)]"
    : variant === "danger" ? "bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/30 hover:bg-rose-400/15"
    : "bg-surface-hover text-copy ring-1 ring-input-border hover:bg-surface";
  return (
    <button type="submit" disabled={pending || disabled} className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${cls}`}>
      {pending ? pendingText : children}
    </button>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border border-divider bg-app-bg p-3 pr-20 font-mono text-xs leading-relaxed text-copy">{code}</pre>
      <div className="absolute right-2 top-2">
        <CopyButton text={code} />
      </div>
    </div>
  );
}
