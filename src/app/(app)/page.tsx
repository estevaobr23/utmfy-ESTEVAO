import { DashboardView } from "@/components/dashboard";
import { Flash } from "@/components/filters";
import { PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function Home({ searchParams }: PageProps<"/">) {
  const s = await requireWorkspace();
  const sp = await searchParams;

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
