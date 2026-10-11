import { OrdersView } from "@/components/orders";
import { PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function OrdersPage({ searchParams }: PageProps<"/pedidos">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Pedidos · todas as ofertas" subtitle="Visão consolidada. Pedidos Cakto pelo horário de criação, sem dados pessoais do cliente." />
      <OrdersView sb={s.sb} ws={s.workspace} sp={sp} action="/pedidos" />
    </>
  );
}
