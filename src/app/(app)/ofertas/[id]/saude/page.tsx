import { notFound } from "next/navigation";
import { HealthList, loadHealth } from "@/components/health";
import { LinkButton, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function OfferHealth({ params }: PageProps<"/ofertas/[id]/saude">) {
  const s = await requireWorkspace();
  const { id } = await params;
  const { data: offer } = await s.sb.from("offers").select("id, name").eq("id", id).eq("workspace_id", s.workspace.id).maybeSingle();
  if (!offer) notFound();
  const { items } = await loadHealth(s.sb, s.workspace.id, id);
  return (
    <>
      <PageHeader title={`Saúde · ${offer.name}`} actions={<><LinkButton href={`/nao-rastreadas?offer=${id}&preset=7d`}>Não rastreadas</LinkButton><LinkButton href="/eventos">Logs</LinkButton></>} />
      <HealthList items={items} />
    </>
  );
}
