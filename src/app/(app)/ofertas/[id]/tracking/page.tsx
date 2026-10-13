import Link from "next/link";
import { CodeBlock } from "@/components/client";
import { HealthList, loadHealth } from "@/components/health";
import { Card, Code, SectionTitle } from "@/components/ui";
import { env } from "@/lib/env";
import { requireOffer } from "@/lib/offer-context";

const URL_PARAMS = "utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}";

export default async function OfferTracking({ params }: PageProps<"/ofertas/[id]/tracking">) {
  const { id } = await params;
  const { sb, workspace, offer } = await requireOffer(id);
  const { items } = await loadHealth(sb, workspace.id, id);
  const snippet = `<script src="${env.appUrl}/t.js" data-offer="${id}" async></script>`;
  return (
    <>
      <SectionTitle title="Tracking" subtitle="O que instalar nos anúncios e nas páginas para cada venda chegar com campanha, conjunto e anúncio." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="1 · Parâmetros de URL dos anúncios">
          <p className="mb-2 text-sm text-slate-500">
            Cole no campo <b>Parâmetros de URL</b> de cada anúncio desta oferta. Detalhes no <Link href="/utms" className="underline">gerador de UTMs</Link>.
          </p>
          <CodeBlock code={URL_PARAMS} />
        </Card>
        <Card title="2 · Script da página de vendas">
          <p className="mb-2 text-sm text-slate-500">
            Cole antes do <Code>&lt;/body&gt;</Code> de todas as páginas do funil. Ele guarda as UTMs e as repassa ao checkout da Cakto.
          </p>
          <CodeBlock code={snippet} />
          {env.appUrl.includes("localhost") && <p className="mt-2 text-xs text-amber-700">APP_URL aponta para localhost: o script só vale depois do deploy.</p>}
        </Card>
      </div>
      <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-800">Diagnóstico desta oferta</h3>
      <HealthList items={items} tela="Tracking da oferta" offer={{ id, name: offer.name, slug: offer.slug }} />
      <p className="mt-2 text-xs text-slate-500">
        Para testar um link de checkout específico, use o <Link href="/diagnostico" className="underline">diagnóstico de tracking</Link>.
      </p>
    </>
  );
}
