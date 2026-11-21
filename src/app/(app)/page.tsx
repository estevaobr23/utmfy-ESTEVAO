import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard";
import { Flash } from "@/components/filters";
import { PageHeader } from "@/components/ui";
import { OFFER_COOKIE, rootRedirectTarget } from "@/lib/core/offer-navigation";
import { requireWorkspace } from "@/lib/session";

export default async function Home({ searchParams }: PageProps<"/">) {
  const s = await requireWorkspace();
  const sp = await searchParams;

  // Abrir a UTMFY volta para a última oferta. Só "Todas as ofertas" escolhido de propósito (/?todas=1) fica no consolidado.
  const saved = (await cookies()).get(OFFER_COOKIE)?.value ?? null;
  // 1º confere só a URL e o formato do cookie (sem consulta); depois valida no servidor (do workspace e não arquivada):
  // oferta apagada nunca vira laço com a tela "oferta não encontrada".
  if (saved && rootRedirectTarget(sp, saved, () => true)) {
    const { data } = await s.sb.from("offers").select("id").eq("id", saved).eq("workspace_id", s.workspace.id).neq("status", "archived").maybeSingle();
    const target = rootRedirectTarget(sp, saved, (id) => data?.id === id);
    if (target) redirect(target);
  }

  return (
    <>
      <PageHeader
        title="Todas as ofertas · consolidado"
        subtitle="Soma das ofertas e dos dados ainda não associados. Para analisar uma operação isolada, escolha uma oferta em Minhas ofertas."
      />
      <Flash sp={sp} />
      <DashboardView sb={s.sb} ws={s.workspace} sp={sp} basePath="/" canWrite={s.canWrite} />
    </>
  );
}
