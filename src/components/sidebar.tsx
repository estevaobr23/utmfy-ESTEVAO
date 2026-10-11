"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut, switchWorkspace } from "@/app/actions";

export type NavOffer = { id: string; name: string; status: string };
type Ws = { id: string; name: string; is_demo: boolean };

export const OFFER_SECTIONS: [string, string][] = [
  ["resumo", "Resumo"],
  ["meta", "Meta Ads"],
  ["pedidos", "Pedidos"],
  ["integracoes", "Integrações"],
  ["tracking", "Tracking"],
  ["configuracoes", "Configurações"],
];

const ALL_SECTIONS: [string, string][] = [
  ["/", "Resumo"],
  ["/campanhas", "Meta Ads"],
  ["/pedidos", "Pedidos"],
  ["/ofertas", "Gerenciar ofertas"],
];

const ADMIN: [string, string][] = [
  ["/meta", "Conexão Meta"],
  ["/cakto", "Conexão Cakto"],
  ["/pixels", "Pixels"],
  ["/saude", "Saúde das integrações"],
  ["/eventos", "Eventos e logs"],
  ["/utms", "Gerador de UTMs"],
  ["/diagnostico", "Diagnóstico de tracking"],
  ["/configuracoes", "Workspace"],
];

const OFFER_PATH = /^\/ofertas\/([0-9a-f-]{36})(?:\/([a-z-]+))?/i;

/** Oferta e seção atuais, lidas da URL (a URL é a fonte do contexto). Só vale oferta conhecida. */
export function useOfferContext(offers: NavOffer[]) {
  const path = usePathname();
  const m = path.match(OFFER_PATH);
  const offerId = m && offers.some((o) => o.id === m[1]) ? m[1] : null;
  return { path, offerId, section: m?.[2] ?? "resumo" };
}

function OfferPicker({ offers, compact = false }: { offers: NavOffer[]; compact?: boolean }) {
  const { offerId, section } = useOfferContext(offers);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const current = offers.find((o) => o.id === offerId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  // Arquivadas saem do seletor (continuam em Gerenciar ofertas).
  const visible = offers.filter((o) => (o.status !== "archived" || o.id === offerId) && o.name.toLowerCase().includes(q.trim().toLowerCase()));
  // Troca de oferta mantém a seção (Meta Ads → Meta Ads da outra oferta).
  const target = (id: string) => `/ofertas/${id}/${offerId ? section : "resumo"}`;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 text-left transition ${
          current ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-white"
        } ${compact ? "py-1.5" : "py-2"} hover:border-slate-400`}
      >
        <span className="min-w-0">
          {!compact && <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Minhas ofertas</span>}
          <span className="block truncate text-sm font-semibold text-slate-900">{current ? current.name : "Todas as ofertas"}</span>
        </span>
        <span className="text-slate-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg" role="listbox">
          {offers.length > 6 && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar oferta..." className="mb-1 w-full rounded border border-slate-200 px-2 py-1 text-sm" />
          )}
          <button type="button" onClick={() => go("/")} className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${!current ? "bg-slate-100 font-semibold" : ""}`}>
            Todas as ofertas <span className="text-xs text-slate-500">· consolidado</span>
          </button>
          <div className="my-1 border-t border-slate-100" />
          {visible.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === offerId}
              onClick={() => go(target(o.id))}
              className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 ${o.id === offerId ? "bg-emerald-50 font-semibold" : ""}`}
            >
              <span className="truncate">{o.name}</span>
              {o.status !== "active" && <span className="shrink-0 text-[10px] uppercase text-slate-400">{o.status === "paused" ? "pausada" : "arquivada"}</span>}
            </button>
          ))}
          {!offers.length && <p className="px-2 py-2 text-xs text-slate-500">Nenhuma oferta cadastrada.</p>}
          {offers.length > 0 && !visible.length && <p className="px-2 py-2 text-xs text-slate-500">Nada encontrado.</p>}
          <div className="my-1 border-t border-slate-100" />
          <button type="button" onClick={() => go("/ofertas#nova")} className="w-full rounded px-2 py-1.5 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50">
            + Nova oferta
          </button>
        </div>
      )}
    </div>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded px-2 py-1.5 text-sm ${active ? "bg-slate-900 font-medium text-white" : "text-slate-700 hover:bg-slate-100"}`}
    >
      {label}
    </Link>
  );
}

function contextLinks(offerId: string | null): [string, string][] {
  return offerId ? OFFER_SECTIONS.map(([seg, label]) => [`/ofertas/${offerId}/${seg}`, label]) : ALL_SECTIONS;
}

function isActive(path: string, href: string, offerId: string | null, section: string) {
  if (offerId) return href.endsWith(`/${section}`);
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function Sidebar({ offers, workspaces, workspaceId, email }: { offers: NavOffer[]; workspaces: Ws[]; workspaceId: string | null; email: string }) {
  const { path, offerId, section } = useOfferContext(offers);
  const inAdmin = ADMIN.some(([href]) => path === href || path.startsWith(`${href}/`));
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="border-b border-slate-100 px-4 py-4">
        <div className="text-sm font-bold tracking-tight">UTMFY Tracker</div>
        <div className="text-xs text-slate-500">Cakto × Meta</div>
      </div>
      <div className="px-3 pt-3">
        <OfferPicker offers={offers} />
      </div>
      <nav className="px-2 py-3">
        <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{offerId ? "Nesta oferta" : "Todas as ofertas · consolidado"}</div>
        {contextLinks(offerId).map(([href, label]) => (
          <NavLink key={href} href={href} label={label} active={!inAdmin && isActive(path, href, offerId, section)} />
        ))}
      </nav>
      <details className="mx-2 border-t border-slate-100 py-2" open={inAdmin}>
        <summary className="cursor-pointer list-none px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600">Administração ▾</summary>
        {ADMIN.map(([href, label]) => (
          <NavLink key={href} href={href} label={label} active={path === href || path.startsWith(`${href}/`)} />
        ))}
      </details>
      <div className="mt-auto border-t border-slate-100 px-4 py-3">
        {workspaces.length > 1 && (
          <form action={switchWorkspace} className="mb-2">
            <select name="workspace_id" defaultValue={workspaceId ?? undefined} className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.is_demo ? "🧪 " : ""}
                  {w.name}
                </option>
              ))}
            </select>
            <button className="mt-1 w-full rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">Trocar workspace</button>
          </form>
        )}
        <div className="truncate text-xs text-slate-500">{email}</div>
        <form action={signOut}>
          <button className="text-xs text-slate-600 underline">Sair</button>
        </form>
      </div>
    </aside>
  );
}

/** Navegação compacta para telas pequenas (mesmo contexto da lateral). */
export function MobileNav({ offers }: { offers: NavOffer[] }) {
  const { path, offerId, section } = useOfferContext(offers);
  return (
    <div className="border-b border-slate-200 bg-white px-3 py-2 md:hidden">
      <OfferPicker offers={offers} compact />
      <nav className="mt-2 flex gap-1 overflow-x-auto text-sm">
        {contextLinks(offerId).map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={`whitespace-nowrap rounded px-2 py-1 ${isActive(path, href, offerId, section) ? "bg-slate-900 text-white" : "text-slate-700"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
