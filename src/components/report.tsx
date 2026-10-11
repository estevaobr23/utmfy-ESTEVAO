import Link from "next/link";
import type { Derived } from "@/lib/core/metrics";
import type { ReportNode } from "@/lib/core/report";
import type { SpendStatus } from "@/lib/core/spend-status";
import { formatMoney, formatNumber, formatPct } from "@/lib/core/money";
import { filtersToQuery, type Filters } from "@/lib/queries";
import { Badge, Kpi } from "./ui";

const roasTone = (r: number | null) => (r == null ? "default" : r >= 1.5 ? "good" : r < 1 ? "bad" : "warn");
const ratio = (v: number | null) => (v == null ? "—" : formatNumber(v, 2));

export function KpiGrid({ m, currency, untrackedHref, spend }: { m: Derived; currency: string; untrackedHref?: string; spend?: SpendStatus }) {
  const money = (v: number | null) => formatMoney(v, currency);
  // Gasto incompleto: nada derivado dele é exibido como se fosse real.
  const ok = spend?.reliable ?? true;
  const na = "gasto incompleto";
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <Kpi label="Gasto" value={money(m.spend)} hint={ok ? "Meta Ads" : "⚠ incompleto"} tone={ok ? "default" : "warn"} />
      <Kpi label="Receita bruta" value={money(m.gross_revenue)} hint="Cakto (aprovadas)" />
      <Kpi label="Receita líquida" value={money(m.net_revenue)} hint={`taxas ${money(m.fees)}`} />
      <Kpi
        label="Lucro estimado"
        value={ok ? money(m.profit) : "—"}
        tone={ok ? (m.profit >= 0 ? "good" : "bad") : "default"}
        hint={ok ? (m.other_costs ? `outros custos ${money(m.other_costs)}` : undefined) : na}
      />
      <Kpi label="ROAS" value={ok ? ratio(m.roas) : "—"} tone={ok ? roasTone(m.roas) : "default"} hint={ok ? `sobre receita líquida · bruto ${ratio(m.gross_roas)}` : na} />
      <Kpi label="CPA" value={ok ? money(m.cpa) : "—"} hint={ok ? undefined : na} />
      <Kpi label="Ticket médio" value={money(m.ticket)} />
      <Kpi label="Vendas aprovadas" value={formatNumber(m.approved_count)} hint={m.approved_items > m.approved_count ? `+${m.approved_items - m.approved_count} bump/upsell` : undefined} />
      <Kpi label="Pix gerados" value={formatNumber(m.pix_generated)} hint={`${formatNumber(m.pix_paid)} pagos`} />
      <Kpi label="Conversão Pix" value={formatPct(m.pix_conversion)} />
      <Kpi label="Reembolsos" value={money(m.refunded_amount)} hint={`${formatNumber(m.refunded_count)} pedido(s)`} tone={m.refunded_count ? "warn" : "default"} />
      <Kpi label="Chargebacks" value={money(m.chargeback_amount)} hint={`${formatNumber(m.chargeback_count)} pedido(s)`} tone={m.chargeback_count ? "bad" : "default"} />
      <Kpi
        label="Não rastreadas"
        value={untrackedHref ? <Link href={untrackedHref} className="underline decoration-dotted">{formatNumber(m.untracked_count)}</Link> : formatNumber(m.untracked_count)}
        hint={money(m.untracked_revenue)}
        tone={m.untracked_count ? "warn" : "default"}
      />
      <Kpi label="Compras (Meta)" value={formatNumber(m.meta_purchases)} hint="reportado pela Meta, só referência" />
    </div>
  );
}

const COLS = ["Gasto", "Receita", "Vendas", "CPA", "ROAS", "Ticket", "Impr.", "Cliques", "CTR", "CPC"];

function Cells({ m, currency }: { m: Derived; currency: string }) {
  const money = (v: number | null) => formatMoney(v, currency);
  const vals = [money(m.spend), money(m.gross_revenue), formatNumber(m.approved_count), money(m.cpa), ratio(m.roas), money(m.ticket), formatNumber(m.impressions), formatNumber(m.clicks), formatPct(m.ctr, 2), money(m.cpc)];
  return (
    <>
      {vals.map((v, i) => (
        <span key={i} className={`text-right tabular-nums ${i === 4 ? (m.roas == null ? "" : m.roas >= 1 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700") : ""}`}>
          {v}
        </span>
      ))}
    </>
  );
}

const GRID = "grid grid-cols-[minmax(260px,2fr)_repeat(10,minmax(78px,1fr))] items-center gap-2 px-3 py-2 text-sm";

function Row({ node, currency, depth, filters }: { node: ReportNode; currency: string; depth: number; filters?: Filters }) {
  const drill =
    filters && !node.id.startsWith("__")
      ? `/campanhas${filtersToQuery({ ...filters, [node.level]: node.id })}`
      : null;
  const label = (
    <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 18 }}>
      {node.children.length > 0 ? <span className="inline-block w-3 text-slate-400">▸</span> : <span className="inline-block w-3" />}
      <span className="truncate" title={`${node.name} (${node.id})`}>
        {node.name}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-slate-400">{node.id.startsWith("__") ? "" : node.id}</span>
      {drill && (
        <Link href={drill} className="shrink-0 text-[10px] text-sky-700 hover:underline">
          filtrar
        </Link>
      )}
    </span>
  );
  if (!node.children.length) {
    return (
      <div className={`${GRID} border-b border-slate-100`}>
        {label}
        <Cells m={node.metrics} currency={currency} />
      </div>
    );
  }
  return (
    <details className="border-b border-slate-100">
      <summary className={`${GRID} cursor-pointer list-none hover:bg-slate-50 ${depth === 0 ? "font-medium" : ""}`}>
        {label}
        <Cells m={node.metrics} currency={currency} />
      </summary>
      <div className="bg-slate-50/50">
        {node.children.map((c) => (
          <Row key={c.id} node={c} currency={currency} depth={depth + 1} filters={filters} />
        ))}
      </div>
    </details>
  );
}

export function CampaignTree({ tree, currency, filters }: { tree: ReportNode[]; currency: string; filters?: Filters }) {
  if (!tree.length) return <p className="p-4 text-sm text-slate-500">Nenhum gasto ou venda atribuída no período.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="min-w-[1100px]">
        <div className={`${GRID} border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500`}>
          <span>Campanha → Conjunto → Anúncio</span>
          {COLS.map((c) => (
            <span key={c} className="text-right">
              {c}
            </span>
          ))}
        </div>
        {tree.map((n) => (
          <Row key={n.id} node={n} currency={currency} depth={0} filters={filters} />
        ))}
      </div>
    </div>
  );
}

export function PeriodBadge({ f }: { f: Filters }) {
  return (
    <Badge tone="muted">
      {f.from === f.to ? f.from : `${f.from} → ${f.to}`}
    </Badge>
  );
}
