import Link from "next/link";
import { RefreshButton } from "@/components/refresh-button";
import { FilterBar } from "@/components/filters";
import { KpiGrid, PeriodBadge } from "@/components/report";
import { SummaryAnalyticsGrid } from "@/components/summary/analytics-grid";
import { ConversionFunnel } from "@/components/summary/conversion-funnel";
import { Notice } from "@/components/ui";
import { timeAgo } from "@/lib/core/dates";
import { catalogOptions, filtersToQuery, listAccounts, listOfferAccounts, listOffers, loadReport, loadSummaryAnalytics, parseFilters } from "@/lib/queries";
import { timed } from "@/lib/perf";
import type { Workspace } from "@/lib/session";
import type { Db } from "@/lib/supabase/types";

/** Resumo consolidado ou fixo por oferta. A rota é a única fonte do offerId. */
export async function DashboardView({ sb, ws, sp, offerId, basePath, untrackedPath = "/nao-rastreadas", canWrite = false }: {
  sb: Db;
  ws: Workspace;
  sp: Record<string, string | string[] | undefined>;
  offerId?: string;
  basePath: string;
  untrackedPath?: string;
  canWrite?: boolean;
}) {
  return timed("dashboard.view", { offerScoped: !!offerId }, async () => {
  const filters = parseFilters(sp, ws.timezone, offerId);
  const reportPromise = loadReport(sb, ws, filters, { includeTree: false });
  const auxiliaryPromise = Promise.all([
    offerId ? Promise.resolve([]) : listOffers(sb, ws.id),
    offerId ? listOfferAccounts(sb, offerId) : listAccounts(sb, ws.id),
    offerId ? Promise.resolve(undefined) : catalogOptions(sb, ws.id, filters),
  ]);
  const report = await reportPromise;
  const [analytics, [offers, accounts, catalog]] = await Promise.all([
    loadSummaryAnalytics(sb, ws, filters, report.summary, report.spendStatus.reliable, report.pixelFunnel),
    auxiliaryPromise,
  ]);
  const query = filtersToQuery(offerId ? { ...filters, offer: null } : filters);
  const untrackedHref = offerId ? `${untrackedPath}${query}${query ? "&" : "?"}atribuicao=nao-rastreadas` : `${untrackedPath}${query}`;
  const lastSync = accounts.map((account) => account.last_sync_at as string | null).filter((value): value is string => !!value).sort().pop() ?? null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#384662] bg-[#27334d] px-4 py-2.5 text-xs text-[#9aa6bb]">
        <span><PeriodBadge f={filters} /> <span className="ml-2">fuso {ws.timezone} · moeda {ws.currency} · receita Cakto · gasto Meta</span></span>
        <span className="flex items-center gap-3">Atualizado {lastSync ? timeAgo(lastSync) : "nunca"}{canWrite && <RefreshButton />}</span>
      </div>
      <FilterBar f={filters} offers={offers} accounts={accounts} catalog={catalog} hideOffer={!!offerId} action={basePath} />
      {!report.spendStatus.reliable && <div className="mb-3"><Notice tone="warn">{report.spendStatus.message} Lucro, ROAS, ROI, margem e CPA permanecem indisponíveis. {offerId && <Link href={`/ofertas/${offerId}/integracoes`} className="underline">Revisar associações</Link>}</Notice></div>}

      <KpiGrid m={report.summary} analytics={analytics} currency={ws.currency} untrackedHref={untrackedHref} spend={report.spendStatus} />
      <div className="mt-4"><ConversionFunnel data={analytics.funnel} /></div>
      <div className="mt-4"><SummaryAnalyticsGrid data={analytics} currency={ws.currency} /></div>

    </>
  );
  });
}
