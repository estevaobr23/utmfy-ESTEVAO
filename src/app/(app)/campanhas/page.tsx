import { Flash } from "@/components/filters";
import { MetaAdsView } from "@/components/meta-ads";
import { PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function CampaignsPage({ searchParams }: PageProps<"/campanhas">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Meta Ads · todas as ofertas" subtitle="Visão consolidada de todas as contas monitoradas. Para uma operação isolada, escolha a oferta em Minhas ofertas." />
      <Flash sp={sp} />
      <MetaAdsView sb={s.sb} ws={s.workspace} sp={sp} path="/campanhas" canWrite={s.canWrite} />
    </>
  );
}
