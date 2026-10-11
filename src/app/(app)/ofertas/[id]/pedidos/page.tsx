import { OrdersView } from "@/components/orders";
import { SectionTitle } from "@/components/ui";
import { requireOffer } from "@/lib/offer-context";

export default async function OfferOrders({ params, searchParams }: PageProps<"/ofertas/[id]/pedidos">) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, workspace } = await requireOffer(id);
  return (
    <>
      <SectionTitle title="Pedidos" subtitle="Vendas Cakto desta oferta (pelos produtos vinculados a ela), pelo horário de criação." />
      <OrdersView sb={sb} ws={workspace} sp={sp} offerId={id} action={`/ofertas/${id}/pedidos`} />
    </>
  );
}
