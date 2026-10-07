import Link from "next/link";
import { signOut, switchWorkspace } from "../actions";
import { requireSession } from "@/lib/session";

const NAV: { group: string; items: [string, string][] }[] = [
  { group: "Visão", items: [["/", "Dashboard geral"], ["/ofertas", "Ofertas"], ["/campanhas", "Campanhas"], ["/pedidos", "Pedidos"], ["/nao-rastreadas", "Não rastreadas"]] },
  { group: "Tracking", items: [["/utms", "Configuração de UTMs"], ["/diagnostico", "Diagnóstico de tracking"], ["/pixels", "Pixels"], ["/eventos", "Eventos"]] },
  { group: "Integrações", items: [["/cakto", "Integração Cakto"], ["/meta", "Contas Meta"], ["/saude", "Health check"], ["/configuracoes", "Configurações"]] },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const s = await requireSession();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="text-sm font-bold tracking-tight">UTMFY Tracker</div>
          <div className="text-xs text-slate-500">Cakto × Meta</div>
        </div>
        {s.workspaces.length > 1 && (
          <form action={switchWorkspace} className="border-b border-slate-100 px-4 py-3">
            <select name="workspace_id" defaultValue={s.workspace?.id} className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
              {s.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.is_demo ? "🧪 " : ""}
                  {w.name}
                </option>
              ))}
            </select>
            <button className="mt-1 w-full rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">Trocar workspace</button>
          </form>
        )}
        <nav className="px-2 py-3">
          {NAV.map((g) => (
            <div key={g.group} className="mb-3">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</div>
              {g.items.map(([href, label]) => (
                <Link key={href} href={href} className="block rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <form action={signOut} className="px-4 pb-4">
          <div className="mb-1 truncate text-xs text-slate-500">{s.user.email}</div>
          <button className="text-xs text-slate-600 underline">Sair</button>
        </form>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <nav className="flex gap-3 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 text-sm md:hidden">
          {NAV.flatMap((g) => g.items).map(([href, label]) => (
            <Link key={href} href={href} className="whitespace-nowrap text-slate-700">
              {label}
            </Link>
          ))}
        </nav>
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
