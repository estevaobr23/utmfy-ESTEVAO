import type { ApprovalItem, DistributionItem, MetricDatum, SummaryAnalytics } from "@/lib/core/summary";
import { formatMoney, formatNumber, formatPct } from "@/lib/core/money";

const PALETTE = ["#005ae3", "#28c76f", "#ff9f43", "#7367f0", "#ee4542", "#00cfe8"];

function ChartCard({ title, subtitle, children, badge }: { title: string; subtitle?: string; children: React.ReactNode; badge?: string }) {
  return (
    <section className="min-h-72 min-w-0 rounded-md bg-surface">
      <header className="flex items-start justify-between gap-3 border-b border-divider px-5 py-3.5">
        <div className="min-w-0"><h3 className="text-sm font-semibold text-copy-strong">{title}</h3>{subtitle && <p className="mt-0.5 text-xs text-copy-muted">{subtitle}</p>}</div>
        {badge && <span className="shrink-0 rounded bg-surface-hover px-2 py-1 text-[10px] font-semibold uppercase text-copy">{badge}</span>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Unavailable({ note }: { note?: string }) {
  return <div className="grid min-h-48 place-items-center rounded border border-dashed border-input-border bg-app-bg p-6 text-center"><div><div className="text-2xl text-copy-muted">⋯</div><p className="mt-2 text-sm font-medium text-copy">Granularidade indisponível</p><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-copy-muted">{note}</p></div></div>;
}

function EmptyChart() {
  return <div className="grid min-h-48 place-items-center text-center text-sm text-copy-muted">Sem atividade no período selecionado.</div>;
}

function Bars({ items, currency }: { items: DistributionItem[]; currency: string }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return <div className="space-y-3">{items.map((item, index) => <div key={item.key}><div className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="truncate text-copy">{item.label}</span><span className="tabular-nums text-copy-muted">{formatNumber(item.count)} · {formatPct(item.share, 1)} · {formatMoney(item.amount, currency)}</span></div><div className="h-3 overflow-hidden rounded-sm bg-app-bg"><div className="h-full rounded-sm" style={{ width: `${Math.max(3, item.count / max * 100)}%`, background: PALETTE[index % PALETTE.length] }} /></div></div>)}</div>;
}

function Donut({ data, currency }: { data: MetricDatum<DistributionItem[]>; currency: string }) {
  const items = data.value ?? [];
  if (!items.length) return <EmptyChart />;
  const stops = items.reduce<{ cursor: number; values: string[] }>((result, item, index) => {
    const end = result.cursor + item.share * 100;
    return { cursor: end, values: [...result.values, `${PALETTE[index % PALETTE.length]} ${result.cursor}% ${end}%`] };
  }, { cursor: 0, values: [] }).values.join(", ");
  return <div className="flex min-h-48 flex-wrap items-center justify-center gap-8"><div className="relative h-36 w-36 rounded-full" style={{ background: `conic-gradient(${stops})` }}><div className="absolute inset-7 grid place-items-center rounded-full bg-surface text-center"><span><b className="block text-2xl text-white">{formatNumber(items.reduce((sum, item) => sum + item.count, 0))}</b><small className="text-copy-muted">vendas</small></span></div></div><div className="min-w-52 space-y-2">{items.map((item, index) => <div key={item.key} className="flex items-center justify-between gap-4 text-xs"><span className="flex items-center gap-2 text-copy"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[index % PALETTE.length] }} />{item.label}</span><b className="text-right tabular-nums text-white">{formatPct(item.share, 1)}<small className="ml-1 font-normal text-copy-muted">{formatMoney(item.amount, currency)}</small></b></div>)}</div></div>;
}

function ApprovalBars({ data }: { data: MetricDatum<ApprovalItem[]> }) {
  const items = data.value ?? [];
  if (!items.length) return <EmptyChart />;
  return <div className="space-y-4">{items.map((item) => <div key={item.key}><div className="mb-1 flex justify-between text-xs"><span className="text-copy">{item.label}</span><span className="text-copy-muted">{item.approved}/{item.attempts} · {item.rate == null ? "N/D" : formatPct(item.rate, 1)}</span></div><div className="h-5 overflow-hidden rounded bg-app-bg"><div className="grid h-full place-items-end rounded bg-primary pr-2 text-[10px] font-semibold text-white" style={{ width: item.rate == null ? "0%" : `${item.rate * 100}%` }}>{item.rate == null ? "" : formatPct(item.rate, 0)}</div></div>{item.state === "partial" && <p className="mt-1 text-[10px] text-amber-200">Somente aprovados importados; taxa não inferida.</p>}</div>)}</div>;
}

export function SummaryAnalyticsGrid({ data, currency }: { data: SummaryAnalytics; currency: string }) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <ChartCard title="Lucro por horário" subtitle="00:00–23:00 · America/Sao_Paulo" badge="Bruto / Líquido"><Unavailable note={data.hourlyProfit.note} /></ChartCard>
      <ChartCard title="Vendas por pagamento" subtitle="Pedidos principais aprovados"><Donut data={data.salesByPayment} currency={currency} /></ChartCard>
      <ChartCard title="Vendas por produto" subtitle="Sem duplicar bumps e upsells">{data.salesByProduct.value?.length ? <Bars items={data.salesByProduct.value} currency={currency} /> : <EmptyChart />}</ChartCard>
      <ChartCard title="Taxa de aprovação" subtitle="Aprovações ÷ tentativas elegíveis"><ApprovalBars data={data.approvalRate} /></ChartCard>
      <ChartCard title="Vendas por fonte" subtitle="Somente atribuição com evidência">{data.salesBySource.value?.length ? <Bars items={data.salesBySource.value} currency={currency} /> : <EmptyChart />}{data.salesBySource.note && <p className="mt-3 text-xs text-amber-200">⚠ {data.salesBySource.note}</p>}</ChartCard>
      <ChartCard title="Faturamento × Investimento × Lucro por hora" subtitle="Séries acumuladas" badge="Bruto / Líquido"><Unavailable note={data.hourlyFinancial.note} /></ChartCard>
    </div>
  );
}
