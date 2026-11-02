import Link from "next/link";
import { RefreshButton } from "@/components/refresh-button";
import { FilterBar } from "@/components/filters";
import { KpiGrid, PeriodBadge } from "@/components/report";
import { summaryBlocks } from "@/components/summary/analytics-grid";
import { EditableDashboard } from "@/components/summary/dashboard-layout";
import { normalizeLayout } from "@/lib/core/dashboard-layout";
import { ConversionFunnel } from "@/components/summary/conversion-funnel";
import { Notice } from "@/components/ui";
import { timeAgo } from "@/lib/core/dates";
import { catalogOptions, filtersToQuery, listAccounts, listOfferAccounts, listOffers, loadReport, loadSummaryAnalytics, parseFilters } from "@/lib/queries";
import { timed } from "@/lib/perf";
import { withAlignedSpend } from "@/lib/core/report";
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
  const [analytics, [offers, accounts, catalog], savedLayout] = await Promise.all([
    loadSummaryAnalytics(sb, ws, filters, report.summary, report.spendStatus.reliable, report.pixelFunnel, { scope: report.hourlyScope, accounts: report.hourlyAccounts }),
    auxiliaryPromise,
    // Layout do modo edição (do próprio usuário). Sem tabela/linha = layout padrão.
    sb.from("dashboard_layouts").select("layout").eq("workspace_id", ws.id).eq("page", "resumo").maybeSingle().then((r) => (r.error ? null : r.data?.layout ?? null), () => null),
  ]);
  // Cartões no mesmo fuso e gasto do gráfico por hora (dia do workspace), só com o spend confiável.
  const aligned = withAlignedSpend(report.summary, report.spendStatus.reliable ? analytics.alignedSpend : null, report.spendUsd);
  const query = filtersToQuery(offerId ? { ...filters, offer: null } : filters);
  const untrackedHref = offerId ? `${untrackedPath}${query}${query ? "&" : "?"}atribuicao=nao-rastreadas` : `${untrackedPath}${query}`;
  const lastSync = accounts.map((account) => account.last_sync_at as string | null).filter((value): value is string => !!value).sort().pop() ?? null;

  return (
    <>
      <section className="summary-card mb-[23px] overflow-hidden rounded-md bg-surface">
        <div className="flex min-h-[58px] flex-wrap items-center justify-between gap-3 border-b border-divider px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-[17px] font-bold text-copy-strong">Resumo</h2>
            <span className="text-xs text-copy-muted"><PeriodBadge f={filters} /> <span className="ml-2">fuso {ws.timezone} · moeda {ws.currency} · receita Hotmart · gasto Meta</span></span>
          </div>
          <span className="flex items-center gap-3 text-xs text-copy-muted">Atualizado {lastSync ? timeAgo(lastSync) : "nunca"}{canWrite && <RefreshButton />}</span>
        </div>
        <FilterBar f={filters} offers={offers} accounts={accounts} catalog={catalog} hideOffer={!!offerId} action={basePath} />
      </section>
      {!report.spendStatus.reliable && <div className="mb-3"><Notice tone="warn">{report.spendStatus.message} Lucro, ROAS, ROI, margem e CPA permanecem indisponíveis. {offerId && <Link href={`/ofertas/${offerId}/integracoes`} className="underline">Revisar integrações da oferta</Link>}</Notice></div>}

      <EditableDashboard
        initial={normalizeLayout(savedLayout)}
        blocks={{
          kpis: <KpiGrid m={aligned.summary} analytics={analytics} currency={ws.currency} untrackedHref={untrackedHref} spend={report.spendStatus} spendUsd={aligned.spendUsd} />,
          funnel: <ConversionFunnel data={analytics.funnel} />,
          ...summaryBlocks(analytics, ws.currency),
        }}
      />

    </>
  );
  });
}
