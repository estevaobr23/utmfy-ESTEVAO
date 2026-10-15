import { cookies } from "next/headers";
import { MobileNav, Sidebar, type NavOffer } from "@/components/sidebar";
import { OFFER_COOKIE } from "@/lib/core/offer-navigation";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const s = await requireSession();
  const { data } = s.workspace
    ? await s.sb.from("offers").select("id, name, status").eq("workspace_id", s.workspace.id).order("name")
    : { data: [] };
  const offers = (data ?? []) as NavOffer[];
  const saved = (await cookies()).get(OFFER_COOKIE)?.value ?? null;
  const remembered = saved && offers.some((o) => o.id === saved) ? saved : null;
  return (
    <div className="flex min-h-screen bg-app-bg">
      <Sidebar offers={offers} rememberedOfferId={remembered} workspaces={s.workspaces} workspaceId={s.workspace?.id ?? null} email={s.user.email ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col bg-app-bg">
        <MobileNav offers={offers} rememberedOfferId={remembered} />
        {s.workspace?.is_demo && (
          <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900">
            MODO DEMO — dados fictícios, isolados em um workspace separado. Nada aqui é produção.
          </div>
        )}
        <main className="w-full flex-1 p-4 md:p-[26px]">{children}</main>
      </div>
    </div>
  );
}
