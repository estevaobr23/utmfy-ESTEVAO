import Link from "next/link";
import { catalogOptions, filtersToQuery, listAccounts, listOffers, loadReport, parseFilters } from "@/lib/queries";
import type { Workspace } from "@/lib/session";
import type { Db } from "../lib/supabase/types";
import { FilterBar } from "./filters";
import { CampaignTree, KpiGrid, PeriodBadge } from "./report";
import { Card, Notice } from "./ui";

/**
 * Resumo usado no consolidado e no de cada oferta. Com offerId, a oferta vem
 * da rota (fixa): nenhum parâmetro da URL troca a oferta dos números.
 */
export async function DashboardView({
  sb,
  ws,
  sp,
  offerId,
  basePath,
  metaPath = "/campanhas",
  untrackedPath = "/nao-rastreadas",
}: {
  sb: Db;
  ws: Workspace;
  sp: Record<string, string | string[] | undefined>;
  offerId?: string;
  basePath: string;
  metaPath?: string;
  untrackedPath?: string;
}) {
  const f = parseFilters(sp, ws.timezone, offerId);
  const [report, offers, accounts, catalog] = await Promise.all([
    loadReport(sb, ws, f),
    offerId ? Promise.resolve([]) : listOffers(sb, ws.id),
    listAccounts(sb, ws.id),
    catalogOptions(sb, ws.id, f),
  ]);
  // Na oferta, o filtro de oferta some do formulário e da URL dos links.
  const q = filtersToQuery(offerId ? { ...f, offer: null } : f);
  const untrackedHref = offerId ? `${untrackedPath}${q}${q ? "&" : "?"}atribuicao=nao-rastreadas` : `${untrackedPath}${q}`;
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
            <Link href="/meta" className="underline">Ver conexão Meta</Link>
          </Notice>
        </div>
      )}
      <KpiGrid m={report.summary} currency={ws.currency} untrackedHref={untrackedHref} spend={report.spendStatus} />
      <div className="mt-6">
        <Card
          title="Campanhas → Conjuntos → Anúncios"
          actions={
            <Link href={`${metaPath}${q}`} className="text-xs text-sky-700 hover:underline">
              abrir Meta Ads
            </Link>
          }
        >
          <CampaignTree tree={report.tree} currency={ws.currency} filters={offerId ? { ...f, offer: null } : f} basePath={metaPath} />
        </Card>
      </div>
    </>
  );
}
