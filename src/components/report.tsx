import Link from "next/link";
import type { Derived } from "@/lib/core/metrics";
import type { ReportNode } from "@/lib/core/report";
import type { SpendStatus } from "@/lib/core/spend-status";
import type { SummaryAnalytics } from "@/lib/core/summary";
import { formatMoney, formatNumber, formatPct } from "@/lib/core/money";
import { filtersToQuery, type Filters } from "@/lib/queries";
import { Badge, Kpi } from "./ui";

const ratio = (value: number | null) => (value == null ? "—" : formatNumber(value, 2));
const roasTone = (value: number | null) => (value == null ? "default" : value >= 1.5 ? "good" : value < 1 ? "bad" : "warn");

export function KpiGrid({ m, analytics, currency, untrackedHref, spend, spendUsd }: {
  m: Derived;
  analytics: SummaryAnalytics;
  currency: string;
  untrackedHref?: string;
  spend?: SpendStatus;
  /** Gasto na moeda da conta de anúncio (USD), mostrado ao lado do valor em reais. */
  spendUsd?: number | null;
}) {
  const money = (value: number | null) => formatMoney(value, currency);
  const reliable = spend?.reliable ?? true;
  const unavailable = reliable ? undefined : "gasto incompleto · ver diagnóstico acima";
  return (
    <div>
      <div className="kpi-grid">
        <Kpi size="lg" label="Faturamento líquido" value={money(m.net_revenue)} hint={`bruto ${money(m.gross_revenue)} · taxas ${money(m.fees)}`} definition="Receita bruta aprovada menos reembolsos, chargebacks e taxas." />
        <Kpi size="lg" label="Gastos com anúncios" value={reliable ? <>{money(m.spend)}{spendUsd != null && currency !== "USD" && <span className="ml-2 text-base font-semibold text-copy-muted">{formatMoney(spendUsd, "USD")}</span>}</> : "—"} hint={reliable ? "Meta Ads" : "escopo incompleto"} tone={reliable ? "default" : "warn"} definition="Soma do gasto Meta somente das campanhas confirmadas para esta oferta." />
        <Kpi size="lg" label="ROAS" value={reliable ? ratio(m.roas) : "—"} tone={reliable ? roasTone(m.roas) : "default"} hint={reliable ? "faturamento líquido ÷ gasto" : unavailable} definition="Faturamento líquido dividido pelo gasto em anúncios. Não é calculado quando o gasto está incompleto." />
        <Kpi size="lg" label="Lucro" value={reliable ? money(m.profit) : "—"} tone={reliable ? (m.profit >= 0 ? "good" : "bad") : "default"} hint={reliable ? "líquido − gasto − custos" : unavailable} definition="Faturamento líquido menos gasto em anúncios e outros custos configurados." />
        <Kpi label="CPA" value={reliable ? money(m.cpa) : "—"} hint={reliable ? `${formatNumber(m.approved_count)} venda(s) aprovada(s)` : unavailable} definition="Gasto em anúncios dividido pelo número de pedidos principais aprovados." />
        <Kpi label="Vendas pendentes" value={money(analytics.pendingAmount)} hint={`${formatNumber(analytics.pendingCount)} pedido(s)`} tone={analytics.pendingCount ? "warn" : "default"} definition="Valor e quantidade de pedidos principais que permanecem com status pendente no período." />
        <Kpi label="ROI" value={reliable ? ratio(m.roi) : "—"} tone={reliable ? (m.roi != null && m.roi >= 0 ? "good" : "bad") : "default"} hint={reliable ? "lucro ÷ investimento total" : unavailable} definition="Lucro dividido por gasto em anúncios mais outros custos. É diferente de ROAS." />
        <Kpi label="ARPU" value={money(m.ticket)} hint="líquido ÷ vendas aprovadas" definition="Faturamento líquido médio por pedido principal aprovado." />
        <div className="xl:col-start-2"><Kpi label="Vendas reembolsadas" value={money(m.refunded_amount)} hint={`${formatNumber(m.refunded_count)} pedido(s)`} tone={m.refunded_count ? "warn" : "default"} definition="Valor de pedidos pagos no período que hoje estão reembolsados." /></div>
        <Kpi label="Margem" value={reliable ? formatPct(m.margin, 2) : "—"} tone={reliable ? (m.margin != null && m.margin >= 0 ? "good" : "bad") : "default"} hint={reliable ? "lucro ÷ faturamento líquido" : unavailable} definition="Percentual do faturamento líquido que permanece como lucro estimado." />
        <Kpi label="Taxas" value={money(m.fees)} hint="taxas da plataforma de pagamento" definition="Soma das taxas dos pedidos aprovados no período." />
      </div>
      {m.untracked_count > 0 && (
        <p className="mt-[19px] rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          {formatNumber(m.untracked_count)} venda(s) sem anúncio identificado ({money(m.untracked_revenue)}). Elas permanecem no total da oferta, sem alocação artificial em campanha. {untrackedHref && <Link href={untrackedHref} className="underline">Ver vendas</Link>}
        </p>
      )}
    </div>
  );
}

const COLS = ["Gasto", "Faturamento", "Vendas", "CPA", "ROAS", "Ticket", "Impr.", "Cliques", "CTR", "CPC"];
const GRID = "grid grid-cols-[minmax(260px,2fr)_repeat(10,minmax(78px,1fr))] items-center gap-2 px-3 py-2 text-sm";

function CampaignCells({ m, currency }: { m: Derived; currency: string }) {
  const money = (value: number | null) => formatMoney(value, currency);
  const values = [money(m.spend), money(m.net_revenue), formatNumber(m.approved_count), money(m.cpa), ratio(m.roas), money(m.ticket), formatNumber(m.impressions), formatNumber(m.clicks), formatPct(m.ctr, 2), money(m.cpc)];
  return <>{values.map((value, index) => <span key={index} className="text-right tabular-nums">{value}</span>)}</>;
}

function CampaignRow({ node, currency, depth, filters, basePath }: { node: ReportNode; currency: string; depth: number; filters?: Filters; basePath: string }) {
  const drill = filters && !node.id.startsWith("__") ? `${basePath}${filtersToQuery({ ...filters, [node.level]: node.id })}` : null;
  const label = <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 18 }}><span className="inline-block w-3 text-copy-muted">{node.children.length ? "▸" : ""}</span><span className="truncate" title={node.name}>{node.name}</span>{drill && <Link href={drill} className="text-[10px] text-[var(--link)]">filtrar</Link>}</span>;
  if (!node.children.length) return <div className={`${GRID} min-h-11 border-b border-divider hover:bg-surface-hover`}>{label}<CampaignCells m={node.metrics} currency={currency} /></div>;
  return <details className="border-b border-divider"><summary className={`${GRID} min-h-11 cursor-pointer list-none hover:bg-surface-hover`}>{label}<CampaignCells m={node.metrics} currency={currency} /></summary><div className="bg-surface">{node.children.map((child) => <CampaignRow key={child.id} node={child} currency={currency} depth={depth + 1} filters={filters} basePath={basePath} />)}</div></details>;
}

export function CampaignTree({ tree, currency, filters, basePath = "/campanhas" }: { tree: ReportNode[]; currency: string; filters?: Filters; basePath?: string }) {
  if (!tree.length) return <p className="p-4 text-sm text-copy-muted">Nenhum gasto ou venda atribuída no período.</p>;
  return <div className="overflow-x-auto rounded-md bg-surface"><div className="min-w-[1100px]"><div className={`${GRID} min-h-11 border-b border-divider bg-app-bg text-xs font-semibold text-copy`}><span>Campanha → Conjunto → Anúncio</span>{COLS.map((column) => <span key={column} className="text-right">{column}</span>)}</div>{tree.map((node) => <CampaignRow key={node.id} node={node} currency={currency} depth={0} filters={filters} basePath={basePath} />)}</div></div>;
}

export function PeriodBadge({ f }: { f: Filters }) {
  return <Badge tone="muted">{f.from === f.to ? f.from : `${f.from} → ${f.to}`}</Badge>;
}
