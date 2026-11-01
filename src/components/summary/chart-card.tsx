import type { ReactNode } from "react";

/** Moldura dos gráficos do Resumo. `actions` fica no canto direito do cabeçalho (abas, seletor Bruto/Líquido). */
export function ChartCard({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="min-h-72 min-w-0 rounded-md bg-surface">
      <header className="flex items-start justify-between gap-3 border-b border-divider px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-copy-strong">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-copy-muted">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Unavailable({ note }: { note?: string }) {
  return (
    <div className="grid min-h-48 place-items-center rounded border border-dashed border-input-border bg-app-bg p-6 text-center">
      <div>
        <div className="text-2xl text-copy-muted">⋯</div>
        <p className="mt-2 text-sm font-medium text-copy">Dados indisponíveis</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-copy-muted">{note}</p>
      </div>
    </div>
  );
}

export function EmptyChart() {
  return <div className="grid min-h-48 place-items-center text-center text-sm text-copy-muted">Sem atividade no período selecionado.</div>;
}
