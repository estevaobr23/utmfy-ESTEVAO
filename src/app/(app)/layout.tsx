import { MobileNav, Sidebar, type NavOffer } from "@/components/sidebar";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const s = await requireSession();
  const { data } = s.workspace
    ? await s.sb.from("offers").select("id, name, status").eq("workspace_id", s.workspace.id).order("name")
    : { data: [] };
  const offers = (data ?? []) as NavOffer[];
  return (
    <div className="flex min-h-screen">
      <Sidebar offers={offers} workspaces={s.workspaces} workspaceId={s.workspace?.id ?? null} email={s.user.email ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav offers={offers} />
        {s.workspace?.is_demo && (
          <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900">
            MODO DEMO — dados fictícios, isolados em um workspace separado. Nada aqui é produção.
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
