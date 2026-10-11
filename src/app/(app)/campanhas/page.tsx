import { FilterBar, Flash } from "@/components/filters";
import { CampaignTree, KpiGrid } from "@/components/report";
import { Card, PageHeader } from "@/components/ui";
import { syncMetaNow } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { METRIC_DEFINITIONS } from "@/lib/core/metrics";
import { catalogOptions, filtersToQuery, listAccounts, listOffers, loadReport, parseFilters } from "@/lib/queries";
import { requireWorkspace } from "@/lib/session";

export default async function CampaignsPage({ searchParams }: PageProps<"/campanhas">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  const f = parseFilters(sp, s.workspace.timezone);
  const [report, offers, accounts, catalog] = await Promise.all([
    loadReport(s.sb, s.workspace, f),
    listOffers(s.sb, s.workspace.id),
    listAccounts(s.sb, s.workspace.id),
    catalogOptions(s.sb, s.workspace.id, f),
  ]);
  return (
    <>
      <PageHeader
        title="Relatório de campanhas"
        subtitle="Receita e vendas vêm dos pedidos Cakto atribuídos; gasto, impressões e cliques vêm da Meta. Clique numa linha para expandir."
        actions={
          s.canWrite && (
            <form action={syncMetaNow}>
              <input type="hidden" name="back" value={`/campanhas${filtersToQuery(f)}`} />
              <SubmitButton variant="secondary" pendingText="Sincronizando...">
                Atualizar dados da Meta
              </SubmitButton>
            </form>
          )
        }
      />
      <Flash sp={sp} />
      <FilterBar f={f} offers={offers} accounts={accounts} catalog={catalog} action="/campanhas" />
      <KpiGrid m={report.summary} currency={s.workspace.currency} untrackedHref={`/nao-rastreadas${filtersToQuery(f)}`} spend={report.spendStatus} />
      <div className="mt-4">
        <CampaignTree tree={report.tree} currency={s.workspace.currency} filters={f} />
      </div>
      <Card title="Como cada métrica é calculada" className="mt-6">
        <dl className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
          {METRIC_DEFINITIONS.map((d) => (
            <div key={d.key}>
              <dt className="inline font-medium">{d.label}: </dt>
              <dd className="inline text-slate-600">{d.formula}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
