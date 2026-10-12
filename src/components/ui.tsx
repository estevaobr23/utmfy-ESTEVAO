import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#34415d] bg-[#27334d] px-5 py-4 shadow-[0_10px_30px_rgba(4,9,20,0.12)]">
      <div>
        <h1 className="text-lg font-semibold text-[#eef2f8]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[#9aa6bb]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Título de seção dentro de uma oferta (o nome da oferta já está na faixa de contexto). */
export function SectionTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-[#eef2f8]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-[#9aa6bb]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-md border border-[#384662] bg-[#27334d] shadow-[0_8px_24px_rgba(4,9,20,0.1)] ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-[#3a4762] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#e2e7ef]">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Kpi({
  label, value, hint, definition, tone = "default", size = "md",
}: { label: string; value: ReactNode; hint?: ReactNode; definition?: ReactNode; tone?: "default" | "good" | "bad" | "warn"; size?: "md" | "lg" }) {
  const color = tone === "good" ? "text-[#25d17f]" : tone === "bad" ? "text-[#ff5b6b]" : tone === "warn" ? "text-[#f5b942]" : "text-[#eef2f8]";
  return (
    <div className={`rounded-md border border-[#384662] bg-[#27334d] px-4 shadow-[0_8px_24px_rgba(4,9,20,0.08)] ${size === "lg" ? "py-4" : "py-3"}`}>
      <div className="flex items-start justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#aab4c6]">
        <span>{label}</span>
        {definition && (
          <details className="group relative normal-case">
            <summary className="grid h-4 w-4 cursor-help list-none place-items-center rounded-full border border-[#69758b] text-[10px] text-[#aab4c6] focus:outline-none focus:ring-1 focus:ring-[#1681ff]" aria-label={`Definição de ${label}`}>i</summary>
            <div role="tooltip" className="absolute right-0 z-40 mt-1 w-64 rounded border border-[#4a5872] bg-[#172137] p-2 text-left text-xs font-normal leading-relaxed text-[#dce2ec] shadow-xl shadow-black/30">{definition}</div>
          </details>
        )}
      </div>
      <div className={`mt-1 font-semibold tabular-nums ${size === "lg" ? "text-2xl" : "text-xl"} ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-[#8f9bb1]">{hint}</div>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  ok: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  warn: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  error: "bg-rose-400/10 text-rose-300 ring-rose-400/25",
  info: "bg-blue-400/10 text-blue-300 ring-blue-400/25",
  muted: "bg-slate-400/10 text-slate-300 ring-slate-400/20",
};

export function Badge({ tone = "muted", children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[tone]}`}>{children}</span>;
}

export const LEVEL_LABEL = { ok: "OK", warn: "ATENÇÃO", error: "ERRO" } as const;
export function LevelBadge({ level }: { level: "ok" | "warn" | "error" }) {
  return <Badge tone={level}>{LEVEL_LABEL[level]}</Badge>;
}

const ORDER_STATUS: Record<string, [string, keyof typeof BADGE]> = {
  pending: ["Aguardando", "warn"],
  refused: ["Recusado", "muted"],
  canceled: ["Cancelado", "muted"],
  paid: ["Pago", "ok"],
  refund_requested: ["Reembolso solicitado", "warn"],
  disputed: ["Em disputa", "warn"],
  refunded: ["Reembolsado", "error"],
  chargedback: ["Chargeback", "error"],
};
export function OrderStatusBadge({ status }: { status: string }) {
  const [label, tone] = ORDER_STATUS[status] ?? [status, "muted"];
  return <Badge tone={tone}>{label}</Badge>;
}

const ATTR: Record<string, keyof typeof BADGE> = {
  EXACT_ID: "ok",
  UTM_PARSED: "info",
  NAME_MATCH: "warn",
  ORGANIC: "muted",
  DIRECT: "muted",
  UNTRACKED: "error",
  UNKNOWN: "error",
};
export function AttributionBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "UNKNOWN";
  return <Badge tone={ATTR[s] ?? "muted"}>{s}</Badge>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[#394761] bg-[#27334d]">
      <table className="w-full min-w-max text-left text-sm text-[#dce2ec]">{children}</table>
    </div>
  );
}
export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th className={`border-b border-[#43516c] bg-[#34415e] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#d4dbe7] ${right ? "text-right" : ""}`}>{children}</th>
);
export const Td = ({ children, right, className = "" }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={`border-b border-[#394761] px-3 py-2 align-top ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-[#46546e] bg-[#27334d] p-8 text-center text-sm text-[#9aa6bb]">{children}</div>;
}

export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const cls =
    variant === "primary" ? "bg-[#0874f9] text-white hover:bg-[#0865d8]"
    : variant === "danger" ? "bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/30 hover:bg-rose-400/15"
    : "bg-[#34415e] text-[#dce2ec] ring-1 ring-[#4a5872] hover:bg-[#3c4a68]";
  return (
    <button {...props} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${cls} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center rounded-md bg-[#34415e] px-3 py-1.5 text-sm font-medium text-[#dce2ec] ring-1 ring-[#4a5872] hover:bg-[#3c4a68]">
      {children}
    </Link>
  );
}

export const inputCls = "rounded-md border border-[#46546e] bg-[#27334d] px-2.5 py-1.5 text-sm text-[#eef2f8] placeholder:text-[#738098] focus:border-[#0874f9] focus:outline-none focus:ring-1 focus:ring-[#0874f9]/40";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-[#cbd3df]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[#8f9bb1]">{hint}</span>}
    </label>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-[#1a2439] px-1 py-0.5 font-mono text-xs text-[#dce2ec]">{children}</code>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const cls = {
    info: "border-blue-400/30 bg-blue-400/10 text-blue-200",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    error: "border-rose-400/30 bg-rose-400/10 text-rose-200",
    ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  }[tone];
  return <div className={`rounded-md border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
