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
    <div className="space-y-3">
      {/* Quanto vendi, quanto gastei, quanto voltou, quanto sobrou. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi size="lg" label="Faturamento líquido" value={money(m.net_revenue)} hint={`bruto ${money(m.gross_revenue)} · taxas ${money(m.fees)}`} />
        <Kpi size="lg" label="Gasto com anúncios" value={money(m.spend)} hint={ok ? "Meta Ads" : "⚠ incompleto"} tone={ok ? "default" : "warn"} />
        <Kpi size="lg" label="ROAS" value={ok ? ratio(m.roas) : "—"} tone={ok ? roasTone(m.roas) : "default"} hint={ok ? `sobre faturamento líquido · bruto ${ratio(m.gross_roas)}` : na} />
        <Kpi
          size="lg"
          label="Lucro"
          value={ok ? money(m.profit) : "—"}
          tone={ok ? (m.profit >= 0 ? "good" : "bad") : "default"}
          hint={ok ? (m.other_costs ? `outros custos ${money(m.other_costs)}` : "faturamento líquido − gasto") : na}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Vendas aprovadas" value={formatNumber(m.approved_count)} hint={m.approved_items > m.approved_count ? `+${m.approved_items - m.approved_count} bump/upsell` : undefined} />
        <Kpi label="CPA" value={ok ? money(m.cpa) : "—"} hint={ok ? undefined : na} />
        <Kpi label="Ticket médio" value={money(m.ticket)} />
        <Kpi label="Reembolsos" value={money(m.refunded_amount)} hint={`${formatNumber(m.refunded_count)} pedido(s)`} tone={m.refunded_count ? "warn" : "default"} />
      </div>
      {m.untracked_count > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {formatNumber(m.untracked_count)} venda(s) sem anúncio identificado ({money(m.untracked_revenue)}): entram nos totais, mas não em nenhuma campanha.{" "}
          {untrackedHref && <Link href={untrackedHref} className="underline">ver vendas</Link>}
        </p>
      )}
      <details className="rounded-md border border-[#384662] bg-[#27334d]">
        <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#aab4c6]">Mais métricas</summary>
        <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Faturamento bruto" value={money(m.gross_revenue)} hint="Cakto (aprovadas)" />
          <Kpi label="Pix gerados" value={formatNumber(m.pix_generated)} hint={`${formatNumber(m.pix_paid)} pagos`} />
          <Kpi label="Conversão Pix" value={formatPct(m.pix_conversion)} />
          <Kpi label="Chargebacks" value={money(m.chargeback_amount)} hint={`${formatNumber(m.chargeback_count)} pedido(s)`} tone={m.chargeback_count ? "bad" : "default"} />
          <Kpi label="CTR · CPC" value={formatPct(m.ctr, 2)} hint={`CPC ${money(m.cpc)} · ${formatNumber(m.clicks)} cliques`} />
          <Kpi label="Compras (Meta)" value={formatNumber(m.meta_purchases)} hint="reportado pela Meta, só referência" />
        </div>
      </details>
    </div>
  );
}

const COLS = ["Gasto", "Faturamento", "Vendas", "CPA", "ROAS", "Ticket", "Impr.", "Cliques", "CTR", "CPC"];

function Cells({ m, currency }: { m: Derived; currency: string }) {
  const money = (v: number | null) => formatMoney(v, currency);
  const vals = [money(m.spend), money(m.net_revenue), formatNumber(m.approved_count), money(m.cpa), ratio(m.roas), money(m.ticket), formatNumber(m.impressions), formatNumber(m.clicks), formatPct(m.ctr, 2), money(m.cpc)];
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

function Row({ node, currency, depth, filters, basePath }: { node: ReportNode; currency: string; depth: number; filters?: Filters; basePath: string }) {
  const drill =
    filters && !node.id.startsWith("__")
      ? `${basePath}${filtersToQuery({ ...filters, [node.level]: node.id })}`
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
      <div className={`${GRID} border-b border-[#394761]`}>
        {label}
        <Cells m={node.metrics} currency={currency} />
      </div>
    );
  }
  return (
    <details className="border-b border-[#394761]">
      <summary className={`${GRID} cursor-pointer list-none hover:bg-[#2d3a56] ${depth === 0 ? "font-medium" : ""}`}>
        {label}
        <Cells m={node.metrics} currency={currency} />
      </summary>
      <div className="bg-[#202b43]">
        {node.children.map((c) => (
          <Row key={c.id} node={c} currency={currency} depth={depth + 1} filters={filters} basePath={basePath} />
        ))}
      </div>
    </details>
  );
}

export function CampaignTree({ tree, currency, filters, basePath = "/campanhas" }: { tree: ReportNode[]; currency: string; filters?: Filters; basePath?: string }) {
  if (!tree.length) return <p className="p-4 text-sm text-slate-500">Nenhum gasto ou venda atribuída no período.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-[#394761] bg-[#27334d]">
      <div className="min-w-[1100px]">
        <div className={`${GRID} border-b border-[#43516c] bg-[#34415e] text-[11px] font-semibold uppercase tracking-wide text-[#d4dbe7]`}>
          <span>Campanha → Conjunto → Anúncio</span>
          {COLS.map((c) => (
            <span key={c} className="text-right">
              {c}
            </span>
          ))}
        </div>
        {tree.map((n) => (
          <Row key={n.id} node={n} currency={currency} depth={0} filters={filters} basePath={basePath} />
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
