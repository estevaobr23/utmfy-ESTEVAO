import Link from "next/link";
import { syncMetaNow } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { FilterBar } from "@/components/filters";
import { CampaignTree, KpiGrid, PeriodBadge } from "@/components/report";
import { SummaryAnalyticsGrid } from "@/components/summary/analytics-grid";
import { ConversionFunnel } from "@/components/summary/conversion-funnel";
import { Card, Notice } from "@/components/ui";
import { timeAgo } from "@/lib/core/dates";
import { formatMoney, formatNumber } from "@/lib/core/money";
import { catalogOptions, filtersToQuery, listAccounts, listOfferAccounts, listOffers, loadReport, loadSummaryAnalytics, parseFilters } from "@/lib/queries";
import type { Workspace } from "@/lib/session";
import type { Db } from "@/lib/supabase/types";

/** Resumo consolidado ou fixo por oferta. A rota é a única fonte do offerId. */
export async function DashboardView({ sb, ws, sp, offerId, basePath, metaPath = "/campanhas", untrackedPath = "/nao-rastreadas", canWrite = false }: {
  sb: Db;
  ws: Workspace;
  sp: Record<string, string | string[] | undefined>;
  offerId?: string;
  basePath: string;
  metaPath?: string;
  untrackedPath?: string;
  canWrite?: boolean;
}) {
  const filters = parseFilters(sp, ws.timezone, offerId);
  const report = await loadReport(sb, ws, filters);
  const [analytics, offers, accounts, catalog] = await Promise.all([
    loadSummaryAnalytics(sb, ws, filters, report.summary, report.spendStatus.reliable),
    offerId ? Promise.resolve([]) : listOffers(sb, ws.id),
    offerId ? listOfferAccounts(sb, offerId) : listAccounts(sb, ws.id),
    offerId ? Promise.resolve(undefined) : catalogOptions(sb, ws.id, filters),
  ]);
  const query = filtersToQuery(offerId ? { ...filters, offer: null } : filters);
  const untrackedHref = offerId ? `${untrackedPath}${query}${query ? "&" : "?"}atribuicao=nao-rastreadas` : `${untrackedPath}${query}`;
  const lastSync = accounts.map((account) => account.last_sync_at as string | null).filter((value): value is string => !!value).sort().pop() ?? null;
  const money = (value: number | null) => formatMoney(value, ws.currency);
  const refreshBack = `${basePath}${query}`;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#384662] bg-[#27334d] px-4 py-2.5 text-xs text-[#9aa6bb]">
        <span><PeriodBadge f={filters} /> <span className="ml-2">fuso {ws.timezone} · moeda {ws.currency} · receita Cakto · gasto Meta</span></span>
        <span className="flex items-center gap-3">Atualizado {lastSync ? timeAgo(lastSync) : "nunca"}{canWrite && <form action={syncMetaNow}><input type="hidden" name="back" value={refreshBack} /><SubmitButton pendingText="Atualizando...">Atualizar</SubmitButton></form>}</span>
      </div>
      <FilterBar f={filters} offers={offers} accounts={accounts} catalog={catalog} hideOffer={!!offerId} action={basePath} />
      {!report.spendStatus.reliable && <div className="mb-3"><Notice tone="warn">{report.spendStatus.message} Lucro, ROAS, ROI, margem e CPA permanecem indisponíveis. {offerId && <Link href={`/ofertas/${offerId}/integracoes`} className="underline">Revisar associações</Link>}</Notice></div>}

      <KpiGrid m={report.summary} analytics={analytics} currency={ws.currency} untrackedHref={untrackedHref} spend={report.spendStatus} />
      <div className="mt-4"><ConversionFunnel data={analytics.funnel} /></div>
      <div className="mt-4"><SummaryAnalyticsGrid data={analytics} /></div>

      <div className="mt-4">
        <Card title="Principais campanhas" actions={<Link href={`${metaPath}${query}`} className="text-xs font-medium text-[#54a8ff] hover:underline">Abrir Meta Ads →</Link>}>
          {report.tree.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-xs">
                <thead><tr className="text-[10px] uppercase tracking-wide text-[#8f9bb1]"><th className="pb-2 text-left">Campanha</th><th className="pb-2 text-right">Vendas</th><th className="pb-2 text-right">Gasto</th><th className="pb-2 text-right">Faturamento</th><th className="pb-2 text-right">Lucro</th><th className="pb-2 text-right">ROAS</th></tr></thead>
                <tbody>{report.tree.slice(0, 5).map((campaign) => <tr key={campaign.id} className="border-t border-[#394761]"><td className="py-2 font-medium text-white">{campaign.name}</td><td className="py-2 text-right tabular-nums">{formatNumber(campaign.metrics.approved_count)}</td><td className="py-2 text-right tabular-nums">{report.spendStatus.reliable ? money(campaign.metrics.spend) : "—"}</td><td className="py-2 text-right tabular-nums">{money(campaign.metrics.net_revenue)}</td><td className={`py-2 text-right tabular-nums ${campaign.metrics.profit >= 0 ? "text-[#25d17f]" : "text-[#ff5b6b]"}`}>{report.spendStatus.reliable ? money(campaign.metrics.profit) : "—"}</td><td className="py-2 text-right tabular-nums">{report.spendStatus.reliable && campaign.metrics.roas != null ? formatNumber(campaign.metrics.roas, 2) : "—"}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="text-sm text-[#8f9bb1]">Nenhuma campanha confirmada para esta oferta no período.</p>}
        </Card>
      </div>

      <details className="mt-4 text-xs text-[#8f9bb1]"><summary className="cursor-pointer">Diagnóstico técnico da hierarquia</summary><div className="mt-2"><CampaignTree tree={report.tree} currency={ws.currency} filters={offerId ? { ...filters, offer: null } : filters} basePath={metaPath} /></div></details>
    </>
  );
}
