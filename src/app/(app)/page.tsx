import { DashboardView } from "@/components/dashboard";
import { Flash } from "@/components/filters";
import { LinkButton, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function Home({ searchParams }: PageProps<"/">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Dashboard geral" subtitle={`Todas as ofertas · ${s.workspace.name}`} actions={<LinkButton href="/saude">Health check</LinkButton>} />
      <Flash sp={sp} />
      <DashboardView sb={s.sb} ws={s.workspace} sp={sp} basePath="/" />
    </>
  );
}
