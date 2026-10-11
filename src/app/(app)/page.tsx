import { DashboardView } from "@/components/dashboard";
import { Flash } from "@/components/filters";
import { PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function Home({ searchParams }: PageProps<"/">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  return (
    <>
      <div className="mb-5 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Visão consolidada</span>
        <PageHeader title="Todas as ofertas" subtitle="Soma de todas as ofertas e também das vendas e gastos que ainda não pertencem a nenhuma. Para ver uma operação isolada, escolha a oferta em Minhas ofertas." />
      </div>
      <Flash sp={sp} />
      <DashboardView sb={s.sb} ws={s.workspace} sp={sp} basePath="/" />
    </>
  );
}
