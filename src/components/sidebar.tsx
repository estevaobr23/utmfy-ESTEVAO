"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { signOut, switchWorkspace } from "@/app/actions";
import { AskClaude } from "@/components/ask-claude";
import { ask } from "@/lib/claude-chat";
import { OFFER_COOKIE, isAdminPath, offerContextFromPath, offerSectionLinks, offerSwitchHref, resolveSelectedOffer } from "@/lib/core/offer-navigation";

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

/**
 * Oferta e seção atuais. A URL é a fonte do contexto; nas telas de Administração (sem id na URL) vale a oferta
 * lembrada, então navegar por Pixels, Webhooks, Saúde etc. NÃO tira você da oferta escolhida. Só escolher
 * "Todas as ofertas" (ou abrir uma tela consolidada) limpa a lembrança.
 */
export function useOfferContext(offers: NavOffer[], initialRemembered: string | null = null) {
  const path = usePathname();
  const ids = offers.map((offer) => offer.id);
  const fromUrl = offerContextFromPath(path, ids);
  const [remembered, setRemembered] = useState<string | null>(initialRemembered);
  // Estado derivado da navegação: ajusta durante a renderização (padrão do React), sem efeito extra nem piscar.
  const selected = resolveSelectedOffer(path, fromUrl.offerId, remembered, ids);
  if (selected !== remembered && (fromUrl.offerId || !isAdminPath(path))) setRemembered(selected);
  useEffect(() => {
    try {
      document.cookie = selected
        ? `${OFFER_COOKIE}=${selected}; path=/; max-age=2592000; SameSite=Lax`
        : `${OFFER_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    } catch { /* cookie bloqueado: a oferta continua valendo nesta aba */ }
  }, [selected]);
  return { path, offerId: selected, section: fromUrl.section };
}

function OfferPicker({ offers, offerId, section, compact = false }: { offers: NavOffer[]; offerId: string | null; section: string; compact?: boolean }) {
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
        className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 text-left ${
          current ? "border-primary bg-app-bg" : "border-input-border bg-app-bg"
        } ${compact ? "py-2" : "py-2.5"} hover:border-primary`}
      >
        <span className="min-w-0">
          {!compact && <span className="block text-[10px] font-semibold uppercase tracking-wider text-copy-muted">Minhas ofertas</span>}
          <span className="block truncate text-sm font-semibold text-copy-strong">{isPending ? "Abrindo…" : current ? current.name : compact ? "Todas as ofertas · consolidado" : "Todas as ofertas"}</span>
        </span>
        <span className="text-copy-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-divider bg-surface p-1 shadow-xl shadow-black/25" role="listbox">
          {offers.length > 6 && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar oferta..." className="mb-1 w-full rounded border border-input-border bg-app-bg px-2 py-1 text-sm text-white outline-none placeholder:text-copy-muted focus:border-primary" />
          )}
          <button type="button" onPointerEnter={() => router.prefetch("/")} onFocus={() => router.prefetch("/")} onClick={() => go("/")} className={`w-full rounded px-2 py-1.5 text-left text-sm text-copy hover:bg-surface-hover ${!current ? "bg-surface-hover font-semibold" : ""}`}>
            Todas as ofertas <span className="text-xs text-copy-muted">· consolidado</span>
          </button>
          <div className="my-1 border-t border-divider" />
          {visible.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === offerId}
              onPointerEnter={() => router.prefetch(target(o.id))}
              onFocus={() => router.prefetch(target(o.id))}
              onClick={() => go(target(o.id))}
              className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-copy hover:bg-surface-hover ${o.id === offerId ? "bg-primary-active font-semibold text-white" : ""}`}
            >
              <span className="truncate">{o.name}</span>
              {o.status !== "active" && <span className="shrink-0 text-[10px] uppercase text-copy-muted">{o.status === "paused" ? "pausada" : "arquivada"}</span>}
            </button>
          ))}
          {!offers.length && <p className="px-2 py-2 text-xs text-copy-muted">Nenhuma oferta cadastrada.</p>}
          {offers.length > 0 && !visible.length && <p className="px-2 py-2 text-xs text-copy-muted">Nada encontrado.</p>}
          <div className="my-1 border-t border-divider" />
          <button type="button" onPointerEnter={() => router.prefetch("/ofertas")} onFocus={() => router.prefetch("/ofertas")} onClick={() => go("/ofertas#nova")} className="w-full rounded px-2 py-1.5 text-left text-sm font-medium text-[var(--link)] hover:bg-surface-hover">
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
      className={`mx-auto flex h-[38px] w-full max-w-[172px] items-center rounded-md px-3 text-sm ${active ? "bg-primary-active font-semibold text-white" : "text-copy hover:bg-surface-hover hover:text-white"}`}
    >
      <NavLinkContent href={href} label={label} />
    </Link>
  );
}

function NavIcon({ href }: { href: string }) {
  const common = "h-[18px] w-[18px] shrink-0 fill-none stroke-current stroke-[1.75]";
  if (href === "/") return <svg aria-hidden="true" viewBox="0 0 24 24" className={common}><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>;
  if (href.includes("campanhas") || href === "/meta") return <svg aria-hidden="true" viewBox="0 0 24 24" className={common}><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" /></svg>;
  if (href.includes("pedidos")) return <svg aria-hidden="true" viewBox="0 0 24 24" className={common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" /></svg>;
  if (href.includes("ofertas")) return <svg aria-hidden="true" viewBox="0 0 24 24" className={common}><path d="m4 12 8-8h7v7l-8 8z" /><circle cx="16" cy="7" r="1" /></svg>;
  if (href.includes("pixels") || href.includes("eventos")) return <svg aria-hidden="true" viewBox="0 0 24 24" className={common}><circle cx="12" cy="12" r="3" /><path d="M4.9 4.9a10 10 0 0 1 14.2 0M4.9 19.1a10 10 0 0 0 14.2 0M2 12h4m12 0h4" /></svg>;
  if (href.includes("saude") || href.includes("diagnostico")) return <svg aria-hidden="true" viewBox="0 0 24 24" className={common}><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>;
  if (href.includes("utms")) return <svg aria-hidden="true" viewBox="0 0 24 24" className={common}><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={common}><circle cx="12" cy="12" r="3" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" /></svg>;
}

function NavLinkContent({ href, label }: { href: string; label: string }) {
  const { pending } = useLinkStatus();
  return <span className="flex min-w-0 flex-1 items-center gap-2.5"><NavIcon href={href} /><span className="min-w-0 flex-1 truncate">{label}</span><span className={`h-2 w-2 rounded-full bg-white ${pending ? "animate-pulse opacity-100" : "opacity-0"}`} aria-hidden />{pending && <span className="sr-only">Carregando</span>}</span>;
}

function AdminMenu({ path, mobile = false }: { path: string; mobile?: boolean }) {
  const inAdmin = ADMIN.some(([href]) => path === href || path.startsWith(`${href}/`));
  const [open, setOpen] = useState(inAdmin);

  return (
    <details
      className={mobile ? "mt-1 border-t border-divider pt-1" : "mx-2 border-t border-divider py-2"}
      open={inAdmin || open}
      onToggle={(event) => {
        if (!inAdmin) setOpen(event.currentTarget.open);
      }}
    >
      <summary className={mobile
        ? "cursor-pointer list-none py-1 text-xs font-semibold uppercase tracking-wider text-copy-muted"
        : "cursor-pointer list-none px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-copy-muted hover:text-copy"}
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
                className={`rounded px-2 py-1.5 text-xs ${active ? "bg-primary-active text-white" : "bg-surface text-copy"}`}
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

export function Sidebar({ offers, rememberedOfferId = null, workspaces, workspaceId, email }: { offers: NavOffer[]; rememberedOfferId?: string | null; workspaces: Ws[]; workspaceId: string | null; email: string }) {
  const { path, offerId, section } = useOfferContext(offers, rememberedOfferId);
  const inAdmin = ADMIN.some(([href]) => path === href || path.startsWith(`${href}/`));
  return (
    <aside className="sticky top-[10px] ml-[10px] hidden h-[calc(100vh-20px)] w-[234px] shrink-0 flex-col overflow-hidden rounded-md bg-surface md:flex">
      <div className="border-b border-divider px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-lg font-black text-white">U</div>
          <div>
            <div className="text-base font-bold tracking-tight text-white">UTMFY</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-copy-muted">Tracker</div>
          </div>
        </div>
      </div>
      <div className="px-3 pt-3">
        <OfferPicker offers={offers} offerId={offerId} section={section} />
      </div>
      <nav className="px-2 py-3">
        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-copy-muted">{offerId ? "Nesta oferta" : "Todas as ofertas · consolidado"}</div>
        {contextLinks(offerId).map(([href, label]) => (
          <NavLink key={href} href={href} label={label} active={!inAdmin && isActive(path, href, offerId, section)} />
        ))}
      </nav>
      <AdminMenu path={path} />
      <div className="mt-auto border-t border-divider bg-app-bg px-4 py-3">
        <div className="mb-3">
          <AskClaude
            label="Falar com o Claude"
            copy={false}
            prompt={ask.livre(offerId ? "Oferta" : "Painel", offers.find((o) => o.id === offerId))}
          />
        </div>
        {workspaces.length > 1 && (
          <form action={switchWorkspace} className="mb-2">
            <select name="workspace_id" defaultValue={workspaceId ?? undefined} className="w-full rounded border border-input-border bg-app-bg px-2 py-1.5 text-xs text-white">
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.is_demo ? "🧪 " : ""}
                  {w.name}
                </option>
              ))}
            </select>
            <button className="mt-1 w-full rounded bg-surface-hover px-2 py-1 text-xs text-copy hover:bg-surface">Trocar workspace</button>
          </form>
        )}
        <div className="truncate text-xs text-copy-muted">{email}</div>
        <form action={signOut}>
          <button className="text-xs text-copy underline">Sair</button>
        </form>
      </div>
    </aside>
  );
}

/** Navegação compacta para telas pequenas (mesmo contexto da lateral). */
export function MobileNav({ offers, rememberedOfferId = null }: { offers: NavOffer[]; rememberedOfferId?: string | null }) {
  const { path, offerId, section } = useOfferContext(offers, rememberedOfferId);
  const router = useRouter();
  const inAdmin = ADMIN.some(([href]) => path === href || path.startsWith(`${href}/`));
  return (
    <div className="border-b border-divider bg-surface px-3 py-2 md:hidden">
      <OfferPicker offers={offers} offerId={offerId} section={section} compact />
      <nav aria-label={offerId ? "Navegação da oferta" : "Navegação consolidada"} className="mt-2 flex gap-1 overflow-x-auto text-sm">
        {contextLinks(offerId).map(([href, label]) => (
          <Link
            key={href}
            href={href}
            onPointerEnter={() => router.prefetch(href)}
            onFocus={() => router.prefetch(href)}
            aria-current={!inAdmin && isActive(path, href, offerId, section) ? "page" : undefined}
            className={`whitespace-nowrap rounded px-2 py-1.5 ${!inAdmin && isActive(path, href, offerId, section) ? "bg-primary-active font-medium text-white" : "text-copy"}`}
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
