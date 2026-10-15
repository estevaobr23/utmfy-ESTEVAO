import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-[26px] flex min-h-[57px] flex-wrap items-center justify-between gap-3 rounded-md bg-surface px-5 py-1.5">
      <div>
        <h1 className="text-[19px] font-semibold text-copy-strong">{title}</h1>
        {subtitle && <p className="text-xs leading-4 text-copy-muted">{subtitle}</p>}
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
        <h2 className="text-base font-semibold text-copy-strong">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-copy-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-md bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-divider px-5 py-3.5">
          <h2 className="text-sm font-semibold text-copy-strong">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Kpi({
  label, value, hint, definition, tone = "default",
}: { label: string; value: ReactNode; hint?: ReactNode; definition?: ReactNode; tone?: "default" | "good" | "bad" | "warn"; size?: "md" | "lg" }) {
  const labelColor = tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : tone === "warn" ? "text-warning" : "text-copy";
  const valueColor = tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : tone === "warn" ? "text-warning" : "text-copy-strong";
  return (
    <div className={`kpi-card rounded-md bg-surface p-5 ${hint ? "min-h-[100px]" : "h-[85px]"}`}>
      <div className={`flex items-start justify-between gap-2 text-[12.5px] font-semibold leading-none ${labelColor}`}>
        <span>{label}</span>
        {definition && (
          <details className="group relative normal-case">
            <summary className="grid h-[13px] w-[13px] cursor-help list-none place-items-center rounded-full border border-current text-[9px] leading-none focus:outline-none" aria-label={`Definição de ${label}`}>i</summary>
            <div role="tooltip" className="tooltip-panel absolute right-0 z-40 mt-1 w-64 rounded-md border border-divider bg-[var(--tooltip)] p-2 text-left text-xs font-normal leading-relaxed text-copy shadow-lg shadow-black/25">{definition}</div>
          </details>
        )}
      </div>
      <div className={`kpi-value mt-2.5 text-2xl font-bold leading-none tabular-nums ${valueColor}`}>{value}</div>
      {hint && <div className="mt-1 text-[11.5px] leading-tight text-copy-muted">{hint}</div>}
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
    <div className="overflow-x-auto rounded-md bg-surface">
      <table className="w-full min-w-max text-left text-sm text-copy">{children}</table>
    </div>
  );
}
export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th className={`h-11 border-b border-divider bg-app-bg px-3 py-2 text-xs font-semibold text-copy ${right ? "text-right" : ""}`}>{children}</th>
);
export const Td = ({ children, right, className = "" }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={`h-11 border-b border-divider px-3 py-2 align-top ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-input-border bg-surface p-8 text-center text-sm text-copy-muted">{children}</div>;
}

export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const cls =
    variant === "primary" ? "bg-primary text-white hover:bg-[var(--primary-hover)]"
    : variant === "danger" ? "bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/30 hover:bg-rose-400/15"
    : "bg-surface-hover text-copy ring-1 ring-input-border hover:bg-[color-mix(in_srgb,var(--surface-hover)_85%,white)]";
  return (
    <button {...props} className={`inline-flex h-[34px] items-center gap-1 rounded px-3 text-sm font-semibold disabled:opacity-50 ${cls} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-[34px] items-center rounded bg-surface-hover px-3 text-sm font-medium text-copy ring-1 ring-input-border hover:bg-[color-mix(in_srgb,var(--surface-hover)_85%,white)]">
      {children}
    </Link>
  );
}

export const inputCls = "h-[34px] rounded border border-input-border bg-transparent px-2.5 text-sm text-copy-strong placeholder:text-copy-muted focus:border-primary focus:outline-none";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-copy">{label}</span>
      {children}
      {hint && <span className="text-xs text-copy-muted">{hint}</span>}
    </label>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-app-bg px-1 py-0.5 font-mono text-xs text-copy">{children}</code>;
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
