import { Flash } from "@/components/filters";
import { MetaAdsView } from "@/components/meta-ads";
import { SectionTitle } from "@/components/ui";
import { requireOffer } from "@/lib/offer-context";

export default async function OfferMeta({ params, searchParams }: PageProps<"/ofertas/[id]/meta">) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, workspace, canWrite } = await requireOffer(id);
  return (
    <>
      <SectionTitle title="Meta Ads" subtitle="Clique numa campanha para ver os conjuntos, e num conjunto para ver os anúncios. Somente leitura: nada aqui altera a Meta." />
      <Flash sp={sp} />
      <MetaAdsView sb={sb} ws={workspace} sp={sp} offerId={id} path={`/ofertas/${id}/meta`} canWrite={canWrite} />
    </>
  );
}
