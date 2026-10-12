import type { ApprovalItem, DistributionItem, MetricDatum, SummaryAnalytics } from "@/lib/core/summary";
import { formatNumber, formatPct } from "@/lib/core/money";

const PALETTE = ["#1681ff", "#25d17f", "#f5b942", "#a855f7", "#ff5b6b", "#54a8ff"];

function ChartCard({ title, subtitle, children, badge }: { title: string; subtitle?: string; children: React.ReactNode; badge?: string }) {
  return (
    <section className="min-w-0 min-h-72 rounded-md border border-[#384662] bg-[#27334d] shadow-[0_8px_24px_rgba(4,9,20,0.1)]">
      <header className="flex items-start justify-between gap-3 border-b border-[#3a4762] px-4 py-3">
        <div className="min-w-0"><h3 className="text-sm font-semibold text-[#e2e7ef]">{title}</h3>{subtitle && <p className="mt-0.5 text-xs text-[#8f9bb1]">{subtitle}</p>}</div>
        {badge && <span className="shrink-0 rounded bg-[#34415e] px-2 py-1 text-[10px] font-semibold uppercase text-[#aeb8c9]">{badge}</span>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Unavailable({ note }: { note?: string }) {
  return <div className="grid min-h-48 place-items-center rounded border border-dashed border-[#4a5872] bg-[#202b43] p-6 text-center"><div><div className="text-2xl text-[#728099]">⋯</div><p className="mt-2 text-sm font-medium text-[#c5cedc]">Granularidade indisponível</p><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[#8f9bb1]">{note}</p></div></div>;
}

function EmptyChart() {
  return <div className="grid min-h-48 place-items-center text-center text-sm text-[#8f9bb1]">Sem atividade no período selecionado.</div>;
}

function Bars({ items }: { items: DistributionItem[] }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return <div className="space-y-3">{items.map((item, index) => <div key={item.key}><div className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="truncate text-[#dce2ec]">{item.label}</span><span className="tabular-nums text-[#aab4c6]">{formatNumber(item.count)} · {formatPct(item.share, 1)}</span></div><div className="h-3 overflow-hidden rounded-sm bg-[#1b263d]"><div className="h-full rounded-sm" style={{ width: `${Math.max(3, item.count / max * 100)}%`, background: PALETTE[index % PALETTE.length] }} /></div></div>)}</div>;
}

function Donut({ data }: { data: MetricDatum<DistributionItem[]> }) {
  const items = data.value ?? [];
  if (!items.length) return <EmptyChart />;
  const stops = items.reduce<{ cursor: number; values: string[] }>((result, item, index) => {
    const end = result.cursor + item.share * 100;
    return { cursor: end, values: [...result.values, `${PALETTE[index % PALETTE.length]} ${result.cursor}% ${end}%`] };
  }, { cursor: 0, values: [] }).values.join(", ");
  return <div className="flex min-h-48 flex-wrap items-center justify-center gap-8"><div className="relative h-36 w-36 rounded-full" style={{ background: `conic-gradient(${stops})` }}><div className="absolute inset-7 grid place-items-center rounded-full bg-[#27334d] text-center"><span><b className="block text-2xl text-white">{formatNumber(items.reduce((sum, item) => sum + item.count, 0))}</b><small className="text-[#8f9bb1]">vendas</small></span></div></div><div className="min-w-44 space-y-2">{items.map((item, index) => <div key={item.key} className="flex items-center justify-between gap-4 text-xs"><span className="flex items-center gap-2 text-[#cbd3df]"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[index % PALETTE.length] }} />{item.label}</span><b className="tabular-nums text-white">{formatPct(item.share, 1)}</b></div>)}</div></div>;
}

function ApprovalBars({ data }: { data: MetricDatum<ApprovalItem[]> }) {
  const items = data.value ?? [];
  if (!items.length) return <EmptyChart />;
  return <div className="space-y-4">{items.map((item) => <div key={item.key}><div className="mb-1 flex justify-between text-xs"><span className="text-[#dce2ec]">{item.label}</span><span className="text-[#aab4c6]">{item.approved}/{item.attempts} · {item.rate == null ? "N/D" : formatPct(item.rate, 1)}</span></div><div className="h-5 overflow-hidden rounded bg-[#1b263d]"><div className="grid h-full place-items-end rounded bg-[#1681ff] pr-2 text-[10px] font-semibold text-white" style={{ width: item.rate == null ? "0%" : `${item.rate * 100}%` }}>{item.rate == null ? "" : formatPct(item.rate, 0)}</div></div>{item.state === "partial" && <p className="mt-1 text-[10px] text-amber-200">Somente aprovados importados; taxa não inferida.</p>}</div>)}</div>;
}

export function SummaryAnalyticsGrid({ data }: { data: SummaryAnalytics }) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <ChartCard title="Lucro por horário" subtitle="00:00–23:00 · America/Sao_Paulo" badge="Bruto / Líquido"><Unavailable note={data.hourlyProfit.note} /></ChartCard>
      <ChartCard title="Vendas por pagamento" subtitle="Pedidos principais aprovados"><Donut data={data.salesByPayment} /></ChartCard>
      <ChartCard title="Vendas por produto" subtitle="Sem duplicar bumps e upsells">{data.salesByProduct.value?.length ? <Bars items={data.salesByProduct.value} /> : <EmptyChart />}</ChartCard>
      <ChartCard title="Taxa de aprovação" subtitle="Aprovações ÷ tentativas elegíveis"><ApprovalBars data={data.approvalRate} /></ChartCard>
      <ChartCard title="Vendas por fonte" subtitle="Somente atribuição com evidência">{data.salesBySource.value?.length ? <Bars items={data.salesBySource.value} /> : <EmptyChart />}{data.salesBySource.note && <p className="mt-3 text-xs text-amber-200">⚠ {data.salesBySource.note}</p>}</ChartCard>
      <ChartCard title="Faturamento × Investimento × Lucro por hora" subtitle="Séries acumuladas" badge="Bruto / Líquido"><Unavailable note={data.hourlyFinancial.note} /></ChartCard>
    </div>
  );
}
