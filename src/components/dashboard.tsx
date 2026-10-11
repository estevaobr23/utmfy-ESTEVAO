import Link from "next/link";
import { catalogOptions, filtersToQuery, listAccounts, listOffers, loadReport, parseFilters } from "@/lib/queries";
import type { Workspace } from "@/lib/session";
import type { Db } from "../lib/supabase/types";
import { FilterBar } from "./filters";
import { CampaignTree, KpiGrid, PeriodBadge } from "./report";
import { Card, Notice } from "./ui";

/** Dashboard usado no geral (todas as ofertas) e no de cada oferta. */
export async function DashboardView({
  sb,
  ws,
  sp,
  offerId,
  basePath,
}: {
  sb: Db;
  ws: Workspace;
  sp: Record<string, string | string[] | undefined>;
  offerId?: string;
  basePath: string;
}) {
  const f = parseFilters(sp, ws.timezone, offerId);
  const [report, offers, accounts, catalog] = await Promise.all([loadReport(sb, ws, f), listOffers(sb, ws.id), listAccounts(sb, ws.id), catalogOptions(sb, ws.id, f)]);
  const q = filtersToQuery(f);
  return (
    <>
      <FilterBar f={f} offers={offers} accounts={accounts} catalog={catalog} hideOffer={!!offerId} action={basePath} />
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
        <PeriodBadge f={f} /> fuso {ws.timezone} · moeda {ws.currency} · receita = Cakto, gasto = Meta
      </div>
      {!report.spendStatus.reliable && (
        <div className="mb-3">
          <Notice tone="warn">
            {report.spendStatus.message} Lucro, ROAS e CPA ficam ocultos até o gasto estar completo.{" "}
            <Link href="/meta" className="underline">Ver integração Meta</Link>
          </Notice>
        </div>
      )}
      <KpiGrid m={report.summary} currency={ws.currency} untrackedHref={`/nao-rastreadas${q}`} spend={report.spendStatus} />
      <div className="mt-6">
        <Card
          title="Campanhas → Conjuntos → Anúncios"
          actions={
            <Link href={`/campanhas${q}`} className="text-xs text-sky-700 hover:underline">
              relatório completo
            </Link>
          }
        >
          <CampaignTree tree={report.tree} currency={ws.currency} filters={f} />
        </Card>
      </div>
    </>
  );
}
