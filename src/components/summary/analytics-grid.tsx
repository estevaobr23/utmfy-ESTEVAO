import type { ApprovalItem, DistributionItem, MetricDatum, SummaryAnalytics } from "@/lib/core/summary";
import { formatMoney, formatNumber, formatPct } from "@/lib/core/money";
import { ChartCard, EmptyChart } from "./chart-card";
import { HourlyFinancialCard, HourlyProfitCard } from "./hourly-charts";
import { TabbedCard } from "./segmented";

const PALETTE = ["#005ae3", "#28c76f", "#ff9f43", "#7367f0", "#ee4542", "#00cfe8", "#82868b"];

const KIND_LABEL: Record<string, string> = { main: "Principal", orderbump: "Bump", upsell: "Upsell", downsell: "Downsell" };
const KIND_TONE: Record<string, string> = {
  main: "bg-blue-400/10 text-blue-300 ring-blue-400/25",
  orderbump: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  upsell: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  downsell: "bg-slate-400/10 text-slate-300 ring-slate-400/20",
};

function Bars({ items, currency, limit = 10, showKind = false }: { items: DistributionItem[]; currency: string; limit?: number; showKind?: boolean }) {
  const visible = items.slice(0, limit);
  const hidden = items.slice(limit);
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <div className="space-y-3">
      {visible.map((item, index) => (
        <div key={item.key}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-copy">
              <span className="truncate">{item.label}</span>
              {showKind && item.kind && <span className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold ring-1 ring-inset ${KIND_TONE[item.kind] ?? KIND_TONE.downsell}`}>{KIND_LABEL[item.kind] ?? item.kind}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-copy-muted">{formatNumber(item.count)} · {formatPct(item.share, 1)} · {formatMoney(item.amount, currency)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-sm bg-app-bg"><div className="h-full rounded-sm" style={{ width: `${Math.max(3, item.count / max * 100)}%`, background: PALETTE[index % PALETTE.length] }} /></div>
        </div>
      ))}
      {hidden.length > 0 && <p className="text-[11px] text-copy-muted">+ {hidden.length} {hidden.length === 1 ? "item" : "itens"} com {formatNumber(hidden.reduce((sum, item) => sum + item.count, 0))} {hidden.reduce((sum, item) => sum + item.count, 0) === 1 ? "venda" : "vendas"} · {formatMoney(hidden.reduce((sum, item) => sum + item.amount, 0), currency)}</p>}
    </div>
  );
}

function BarsOrEmpty({ data, currency, showKind }: { data: MetricDatum<DistributionItem[]>; currency: string; showKind?: boolean }) {
  return data.value?.length ? <Bars items={data.value} currency={currency} showKind={showKind} /> : <EmptyChart />;
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

function Note({ children }: { children?: string }) {
  return children ? <p className="mt-3 text-xs text-amber-200">⚠ {children}</p> : null;
}

export function SummaryAnalyticsGrid({ data, currency }: { data: SummaryAnalytics; currency: string }) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <HourlyProfitCard datum={data.hourlyProfit} currency={currency} />
      <ChartCard title="Vendas por pagamento" subtitle="Pedidos principais aprovados"><Donut data={data.salesByPayment} currency={currency} /></ChartCard>
      <TabbedCard
        title="Vendas por produto"
        subtitle="Cada pedido conta uma vez"
        tabs={[
          { id: "all", label: "Todos", subtitle: "Principais, order bumps e upsells · cada pedido conta uma vez", content: <BarsOrEmpty data={data.salesByProduct} currency={currency} showKind /> },
          { id: "main", label: "Só principais", subtitle: "Somente pedidos principais (as vendas do CPA)", content: <BarsOrEmpty data={data.salesByMainProduct} currency={currency} /> },
        ]}
      />
      <ChartCard title="Taxa de aprovação" subtitle="Aprovações ÷ tentativas elegíveis"><ApprovalBars data={data.approvalRate} /></ChartCard>
      <TabbedCard
        title="Vendas por fonte"
        subtitle="Pedidos principais aprovados"
        tabs={[
          { id: "source", label: "Fonte", subtitle: "Atribuição com evidência (UTM, sessão ou anúncio)", content: <><BarsOrEmpty data={data.salesBySource} currency={currency} /><Note>{data.salesBySource.note}</Note></> },
          { id: "campaign", label: "Campanha", subtitle: "Campanha da Meta atribuída à venda", content: <><BarsOrEmpty data={data.salesByCampaign} currency={currency} /></> },
        ]}
      />
      <HourlyFinancialCard datum={data.hourlyFinancial} currency={currency} />
    </div>
  );
}
