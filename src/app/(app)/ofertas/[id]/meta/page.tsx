import { syncMetaNow } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { FilterBar, Flash } from "@/components/filters";
import { CampaignTree } from "@/components/report";
import { Notice, SectionTitle } from "@/components/ui";
import { timeAgo } from "@/lib/core/dates";
import { catalogOptions, filtersToQuery, listAccounts, loadReport, parseFilters } from "@/lib/queries";
import { requireOffer } from "@/lib/offer-context";

export default async function OfferMeta({ params, searchParams }: PageProps<"/ofertas/[id]/meta">) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, workspace, canWrite } = await requireOffer(id);
  const f = parseFilters(sp, workspace.timezone, id);
  const [report, accounts, catalog, lastSync] = await Promise.all([
    loadReport(sb, workspace, f),
    listAccounts(sb, workspace.id),
    catalogOptions(sb, workspace.id, f),
    sb.from("sync_jobs").select("finished_at").eq("workspace_id", workspace.id).eq("kind", "meta_insights").in("status", ["success", "partial"]).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const path = `/ofertas/${id}/meta`;
  return (
    <>
      <SectionTitle
        title="Meta Ads"
        subtitle={<>Última sincronização: {lastSync.data?.finished_at ? timeAgo(lastSync.data.finished_at) : "nunca"}</>}
        actions={
          canWrite && (
            <form action={syncMetaNow}>
              <input type="hidden" name="back" value={`${path}${filtersToQuery({ ...f, offer: null })}`} />
              <SubmitButton variant="secondary" pendingText="Atualizando...">Atualizar dados</SubmitButton>
            </form>
          )
        }
      />
      <Flash sp={sp} />
      {!report.spendStatus.reliable && <div className="mb-3"><Notice tone="warn">{report.spendStatus.message}</Notice></div>}
      <FilterBar f={f} accounts={accounts} catalog={catalog} hideOffer action={path} />
      <CampaignTree tree={report.tree} currency={workspace.currency} filters={{ ...f, offer: null }} basePath={path} />
    </>
  );
}
