import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : tone === "warn" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  error: "bg-rose-50 text-rose-700 ring-rose-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  muted: "bg-slate-50 text-slate-600 ring-slate-200",
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
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-max text-left text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th className={`border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${right ? "text-right" : ""}`}>{children}</th>
);
export const Td = ({ children, right, className = "" }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={`border-b border-slate-100 px-3 py-2 align-top ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const cls =
    variant === "primary" ? "bg-slate-900 text-white hover:bg-slate-700"
    : variant === "danger" ? "bg-white text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50"
    : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50";
  return (
    <button {...props} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${cls} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
      {children}
    </Link>
  );
}

export const inputCls = "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-800">{children}</code>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const cls = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-rose-200 bg-rose-50 text-rose-900",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return <div className={`rounded-md border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
