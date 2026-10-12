import { Suspense } from "react";
import { Flash } from "@/components/filters";
import { MetaAdsSkeleton } from "@/components/loading-skeletons";
import { MetaAdsView } from "@/components/meta-ads";
import { SectionTitle } from "@/components/ui";
import { requireOffer } from "@/lib/offer-context";

async function MetaContent({ params, searchParams }: PageProps<"/ofertas/[id]/meta">) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, workspace, canWrite } = await requireOffer(id);
  return (
    <>
      <Flash sp={sp} />
      <MetaAdsView sb={sb} ws={workspace} sp={sp} offerId={id} path={`/ofertas/${id}/meta`} canWrite={canWrite} />
    </>
  );
}

export default function OfferMeta(props: PageProps<"/ofertas/[id]/meta">) {
  return (
    <>
      <SectionTitle title="Meta Ads" subtitle="Clique numa campanha para ver conjuntos e anúncios. Esta área é somente leitura." />
      <Suspense fallback={<MetaAdsSkeleton />}><MetaContent {...props} /></Suspense>
    </>
  );
}
