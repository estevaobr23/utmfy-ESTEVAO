"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { signOut, switchWorkspace } from "@/app/actions";
import { AskClaude } from "@/components/ask-claude";
import { ask } from "@/lib/claude-chat";
import { offerContextFromPath, offerSectionLinks, offerSwitchHref } from "@/lib/core/offer-navigation";

export type NavOffer = { id: string; name: string; status: string };
type Ws = { id: string; name: string; is_demo: boolean };

const ALL_SECTIONS: [string, string][] = [
  ["/", "Resumo"],
  ["/campanhas", "Meta Ads"],
  ["/pedidos", "Pedidos"],
  ["/ofertas", "Gerenciar ofertas"],
];

const ADMIN: [string, string][] = [
  ["/meta", "Conexão Meta"],
  ["/cakto", "Webhooks Cakto"],
  ["/pixels", "Pixels"],
  ["/saude", "Saúde das integrações"],
  ["/eventos", "Eventos e logs"],
  ["/utms", "Gerador de UTMs"],
  ["/diagnostico", "Diagnóstico de tracking"],
  ["/configuracoes", "Workspace"],
];

/** Oferta e seção atuais, lidas da URL (a URL é a fonte do contexto). Só vale oferta conhecida. */
export function useOfferContext(offers: NavOffer[]) {
  const path = usePathname();
  return { path, ...offerContextFromPath(path, offers.map((offer) => offer.id)) };
}

function OfferPicker({ offers, compact = false }: { offers: NavOffer[]; compact?: boolean }) {
  const { offerId, section } = useOfferContext(offers);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [isPending, startTransition] = useTransition();
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
    startTransition(() => router.push(href));
  };
  // Arquivadas saem do seletor (continuam em Gerenciar ofertas).
  const visible = offers.filter((o) => (o.status !== "archived" || o.id === offerId) && o.name.toLowerCase().includes(q.trim().toLowerCase()));
  // Troca de oferta mantém a seção (Meta Ads → Meta Ads da outra oferta).
  const target = (id: string) => offerSwitchHref(id, offerId, section);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 text-left transition ${
          current ? "border-[#0874f9] bg-[#172440]" : "border-[#3b4964] bg-[#19243a]"
        } ${compact ? "py-2" : "py-2.5"} hover:border-[#0874f9]`}
      >
        <span className="min-w-0">
          {!compact && <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#7f8ca4]">Minhas ofertas</span>}
          <span className="block truncate text-sm font-semibold text-[#f3f6fb]">{isPending ? "Abrindo…" : current ? current.name : compact ? "Todas as ofertas · consolidado" : "Todas as ofertas"}</span>
        </span>
        <span className="text-[#8794aa]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-[#42506a] bg-[#202c45] p-1 shadow-2xl shadow-black/30" role="listbox">
          {offers.length > 6 && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar oferta..." className="mb-1 w-full rounded border border-[#46546e] bg-[#172137] px-2 py-1 text-sm text-white outline-none placeholder:text-[#728097] focus:border-[#0874f9]" />
          )}
          <button type="button" onPointerEnter={() => router.prefetch("/")} onFocus={() => router.prefetch("/")} onClick={() => go("/")} className={`w-full rounded px-2 py-1.5 text-left text-sm text-[#dce2ec] hover:bg-[#2f3d59] ${!current ? "bg-[#2f3d59] font-semibold" : ""}`}>
            Todas as ofertas <span className="text-xs text-[#8e9bb0]">· consolidado</span>
          </button>
          <div className="my-1 border-t border-[#35435e]" />
          {visible.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === offerId}
              onPointerEnter={() => router.prefetch(target(o.id))}
              onFocus={() => router.prefetch(target(o.id))}
              onClick={() => go(target(o.id))}
              className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-[#dce2ec] hover:bg-[#2f3d59] ${o.id === offerId ? "bg-[#12386a] font-semibold text-white" : ""}`}
            >
              <span className="truncate">{o.name}</span>
              {o.status !== "active" && <span className="shrink-0 text-[10px] uppercase text-[#8491a8]">{o.status === "paused" ? "pausada" : "arquivada"}</span>}
            </button>
          ))}
          {!offers.length && <p className="px-2 py-2 text-xs text-[#8e9bb0]">Nenhuma oferta cadastrada.</p>}
          {offers.length > 0 && !visible.length && <p className="px-2 py-2 text-xs text-[#8e9bb0]">Nada encontrado.</p>}
          <div className="my-1 border-t border-[#35435e]" />
          <button type="button" onPointerEnter={() => router.prefetch("/ofertas")} onFocus={() => router.prefetch("/ofertas")} onClick={() => go("/ofertas#nova")} className="w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[#58a8ff] hover:bg-[#2f3d59]">
            + Nova oferta
          </button>
        </div>
      )}
    </div>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onPointerEnter={() => router.prefetch(href)}
      onFocus={() => router.prefetch(href)}
      aria-current={active ? "page" : undefined}
      className={`my-0.5 block rounded-md px-3 py-2 text-sm transition ${active ? "bg-[#0874f9] font-semibold text-white shadow-[0_0_18px_rgba(8,116,249,0.28)]" : "text-[#d3dae6] hover:bg-[#2d3a55] hover:text-white"}`}
    >
      <NavLinkContent label={label} />
    </Link>
  );
}

function NavLinkContent({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <span className="flex items-center justify-between gap-2"><span>{label}</span><span className={`h-2 w-2 rounded-full bg-white ${pending ? "animate-pulse opacity-100" : "opacity-0"}`} aria-hidden />{pending && <span className="sr-only">Carregando</span>}</span>;
}

function AdminMenu({ path, mobile = false }: { path: string; mobile?: boolean }) {
  const inAdmin = ADMIN.some(([href]) => path === href || path.startsWith(`${href}/`));
  const [open, setOpen] = useState(inAdmin);

  return (
    <details
      className={mobile ? "mt-1 border-t border-[#35435e] pt-1" : "mx-2 border-t border-[#35435e] py-2"}
      open={inAdmin || open}
      onToggle={(event) => {
        if (!inAdmin) setOpen(event.currentTarget.open);
      }}
    >
      <summary className={mobile
        ? "cursor-pointer list-none py-1 text-xs font-semibold uppercase tracking-wider text-[#8f9bb1]"
        : "cursor-pointer list-none px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#7f8ca4] hover:text-[#cbd3df]"}
      >
        Administração ▾
      </summary>
      {mobile ? (
        <nav aria-label="Administração" className="grid grid-cols-2 gap-1 pb-1">
          {ADMIN.map(([href, label]) => {
            const active = path === href || path.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded px-2 py-1.5 text-xs ${active ? "bg-[#0874f9] text-white" : "bg-[#202c45] text-[#cbd3df]"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      ) : (
        ADMIN.map(([href, label]) => (
          <NavLink key={href} href={href} label={label} active={path === href || path.startsWith(`${href}/`)} />
        ))
      )}
    </details>
  );
}

function contextLinks(offerId: string | null): [string, string][] {
  return offerId ? offerSectionLinks(offerId) : ALL_SECTIONS;
}

function isActive(path: string, href: string, offerId: string | null, section: string) {
  if (offerId) return href.endsWith(`/${section}`);
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function Sidebar({ offers, workspaces, workspaceId, email }: { offers: NavOffer[]; workspaces: Ws[]; workspaceId: string | null; email: string }) {
  const { path, offerId, section } = useOfferContext(offers);
  const inAdmin = ADMIN.some(([href]) => path === href || path.startsWith(`${href}/`));
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[#34415d] bg-[#222d46] md:flex">
      <div className="border-b border-[#34415d] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-[#0874f9] to-[#45a8ff] text-lg font-black text-white shadow-lg shadow-blue-950/30">U</div>
          <div>
            <div className="text-base font-bold tracking-tight text-white">UTMFY</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8f9bb1]">Tracker</div>
          </div>
        </div>
      </div>
      <div className="px-3 pt-3">
        <OfferPicker offers={offers} />
      </div>
      <nav className="px-2 py-3">
        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#738098]">{offerId ? "Nesta oferta" : "Todas as ofertas · consolidado"}</div>
        {contextLinks(offerId).map(([href, label]) => (
          <NavLink key={href} href={href} label={label} active={!inAdmin && isActive(path, href, offerId, section)} />
        ))}
      </nav>
      <AdminMenu path={path} />
      <div className="mt-auto border-t border-[#34415d] bg-[#1d2840] px-4 py-3">
        <div className="mb-3">
          <AskClaude
            label="Falar com o Claude"
            copy={false}
            prompt={ask.livre(offerId ? "Oferta" : "Painel", offers.find((o) => o.id === offerId))}
          />
        </div>
        {workspaces.length > 1 && (
          <form action={switchWorkspace} className="mb-2">
            <select name="workspace_id" defaultValue={workspaceId ?? undefined} className="w-full rounded border border-[#46546e] bg-[#172137] px-2 py-1.5 text-xs text-white">
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.is_demo ? "🧪 " : ""}
                  {w.name}
                </option>
              ))}
            </select>
            <button className="mt-1 w-full rounded bg-[#34415e] px-2 py-1 text-xs text-[#dce2ec] hover:bg-[#3d4b68]">Trocar workspace</button>
          </form>
        )}
        <div className="truncate text-xs text-[#9aa6bb]">{email}</div>
        <form action={signOut}>
          <button className="text-xs text-[#cbd3df] underline">Sair</button>
        </form>
      </div>
    </aside>
  );
}

/** Navegação compacta para telas pequenas (mesmo contexto da lateral). */
export function MobileNav({ offers }: { offers: NavOffer[] }) {
  const { path, offerId, section } = useOfferContext(offers);
  const router = useRouter();
  const inAdmin = ADMIN.some(([href]) => path === href || path.startsWith(`${href}/`));
  return (
    <div className="border-b border-[#34415d] bg-[#222d46] px-3 py-2 md:hidden">
      <OfferPicker offers={offers} compact />
      <nav aria-label={offerId ? "Navegação da oferta" : "Navegação consolidada"} className="mt-2 flex gap-1 overflow-x-auto text-sm">
        {contextLinks(offerId).map(([href, label]) => (
          <Link
            key={href}
            href={href}
            onPointerEnter={() => router.prefetch(href)}
            onFocus={() => router.prefetch(href)}
            aria-current={!inAdmin && isActive(path, href, offerId, section) ? "page" : undefined}
            className={`whitespace-nowrap rounded px-2 py-1.5 ${!inAdmin && isActive(path, href, offerId, section) ? "bg-[#0874f9] font-medium text-white" : "text-[#cbd3df]"}`}
          >
            <MobileLinkContent label={label} />
          </Link>
        ))}
      </nav>
      <AdminMenu path={path} mobile />
    </div>
  );
}

function MobileLinkContent({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <span className="inline-flex items-center gap-1.5">{label}<span className={`h-1.5 w-1.5 rounded-full bg-white ${pending ? "animate-pulse opacity-100" : "opacity-0"}`} aria-hidden /></span>;
}
