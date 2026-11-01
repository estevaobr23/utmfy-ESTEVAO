import type { ReactNode } from "react";
import type { BlockId } from "@/lib/core/dashboard-layout";
import type { DistributionItem, MetricDatum, SummaryAnalytics } from "@/lib/core/summary";
import { formatMoney, formatNumber, formatPct } from "@/lib/core/money";
import { EmptyChart } from "./chart-card";
import { ApprovalCard, PaymentCard } from "./payment-card";
import { HourlyFinancialCard, HourlyProfitCard } from "./hourly-charts";
import { TabbedCard } from "./segmented";

const PALETTE = ["#7356f7", "#1fae5b", "#f5a524", "#e0569b", "#ef4444", "#2ec4b6", "#8e919b"];

const KIND_LABEL: Record<string, string> = { main: "Principal", orderbump: "Bump", upsell: "Upsell", downsell: "Downsell" };
const KIND_TONE: Record<string, string> = {
  main: "bg-[var(--info-bg)] text-[var(--info-text)] ring-[var(--info-ring)]",
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

function Note({ children }: { children?: string }) {
  return children ? <p className="mt-3 text-xs text-amber-200">⚠ {children}</p> : null;
}

/** Os blocos de análise do Resumo, prontos para a grade editável (ids = BlockId de dashboard-layout). */
export function summaryBlocks(data: SummaryAnalytics, currency: string): Partial<Record<BlockId, ReactNode>> {
  return {
    "hourly-profit": <HourlyProfitCard datum={data.hourlyProfit} currency={currency} />,
    payment: <PaymentCard data={data.salesByPayment} currency={currency} />,
    product: (
      <TabbedCard
        title="Vendas por produto"
        subtitle="Cada pedido conta uma vez"
        tabs={[
          { id: "all", label: "Todos", subtitle: "Principais, order bumps e upsells · cada pedido conta uma vez", content: <BarsOrEmpty data={data.salesByProduct} currency={currency} showKind /> },
          { id: "main", label: "Só principais", subtitle: "Somente pedidos principais (as vendas do CPA)", content: <BarsOrEmpty data={data.salesByMainProduct} currency={currency} /> },
        ]}
      />
    ),
    approval: <ApprovalCard data={data.approvalRate} />,
    source: (
      <TabbedCard
        title="Vendas por fonte"
        subtitle="Pedidos principais aprovados"
        tabs={[
          { id: "source", label: "Fonte", subtitle: "Atribuição com evidência (UTM, sessão ou anúncio)", content: <><BarsOrEmpty data={data.salesBySource} currency={currency} /><Note>{data.salesBySource.note}</Note></> },
          { id: "campaign", label: "Campanha", subtitle: "Campanha da Meta atribuída à venda", content: <BarsOrEmpty data={data.salesByCampaign} currency={currency} /> },
        ]}
      />
    ),
    "hourly-financial": <HourlyFinancialCard datum={data.hourlyFinancial} currency={currency} />,
  };
}

/** Grade fixa (sem modo edição), na ordem padrão. */
export function SummaryAnalyticsGrid({ data, currency }: { data: SummaryAnalytics; currency: string }) {
  const blocks = summaryBlocks(data, currency);
  return <div className="grid min-w-0 gap-4 xl:grid-cols-2">{Object.entries(blocks).map(([id, node]) => <div key={id} className="min-w-0">{node}</div>)}</div>;
}
