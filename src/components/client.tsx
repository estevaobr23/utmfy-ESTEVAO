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
      className="inline-flex items-center rounded-md bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
    >
      {done ? "Copiado ✓" : label}
    </button>
  );
}

export function SubmitButton({ children, variant = "primary", pendingText = "Processando..." }: { children: React.ReactNode; variant?: "primary" | "secondary" | "danger"; pendingText?: string }) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary" ? "bg-slate-900 text-white hover:bg-slate-700"
    : variant === "danger" ? "bg-white text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50"
    : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50";
  return (
    <button type="submit" disabled={pending} className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${cls}`}>
      {pending ? pendingText : children}
    </button>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 pr-20 font-mono text-xs leading-relaxed text-slate-100">{code}</pre>
      <div className="absolute right-2 top-2">
        <CopyButton text={code} />
      </div>
    </div>
  );
}
