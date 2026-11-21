"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cardResult, hasMovement, OFFER_SORTS, offerStatusLabel, parseOfferSort, sortCards, type OfferCard, type OfferSort } from "@/lib/core/offer-cards";
import { formatMoney, formatNumber, formatPct } from "@/lib/core/money";
import { ProfitSparkline } from "./sparkline";

type View = "cards" | "lista";
const PREF_KEY = "utmfy_offer_board";

const STATUS_CLS: Record<string, string> = {
  active: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  paused: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  archived: "bg-slate-400/10 text-slate-300 ring-slate-400/20",
};

function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset ${STATUS_CLS[status] ?? STATUS_CLS.archived}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{offerStatusLabel(status)}</span>;
}

const profitColor = (c: OfferCard) => (!c.reliable ? "text-copy-muted" : c.metrics.profit > 0 ? "text-success" : c.metrics.profit < 0 ? "text-danger-accessible" : "text-copy-strong");
const roasText = (c: OfferCard) => (!c.reliable || c.metrics.roas == null ? "—" : `${formatNumber(c.metrics.roas, 2)}×`);
const marginText = (c: OfferCard) => (!c.reliable ? "—" : formatPct(c.metrics.margin, 0));

function Metric({ label, value, tone = "text-copy-strong" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-app-bg/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-copy-muted">{label}</div>
      <div className={`mt-0.5 truncate text-[15px] font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function OfferCardView({ c, currency }: { c: OfferCard; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  const result = cardResult(c);
  const ring = result === "positive" ? "ring-[color-mix(in_srgb,var(--success)_35%,transparent)]" : result === "negative" ? "ring-[color-mix(in_srgb,var(--danger)_35%,transparent)]" : "ring-divider";
  const quiet = !hasMovement(c);
  return (
    <article className={`flex flex-col rounded-md bg-surface p-4 ring-1 ring-inset ${ring}`}>
      <div className="flex items-start justify-between gap-2">
        <StatusPill status={c.status} />
        {!c.reliable && hasMovement(c) && <span title={c.spendMessage ?? undefined} className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-inset ring-amber-400/25">gasto incompleto</span>}
      </div>
      <Link href={`/ofertas/${c.id}/resumo`} className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-copy-strong hover:underline">{c.name}</Link>
      <div className="mt-3 rounded-md bg-app-bg/60 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-copy-muted">Lucro</div>
        <div className={`mt-0.5 text-2xl font-bold tabular-nums ${profitColor(c)}`}>{c.reliable ? money(c.metrics.profit) : "—"}</div>
        {quiet ? <div className="text-[11px] text-copy-muted">Sem movimento no período</div> : c.daily && <ProfitSparkline points={c.daily} currencyFormat={money} />}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Metric label="Faturamento" value={money(c.metrics.gross_revenue)} />
        <Metric label="Gasto c/ anúncio" value={c.reliable ? money(c.metrics.spend) : "—"} />
        <Metric label="ROAS" value={roasText(c)} />
        <Metric label="Margem" value={marginText(c)} tone={!c.reliable || c.metrics.margin == null ? "text-copy-strong" : c.metrics.margin >= 0 ? "text-success" : "text-danger-accessible"} />
      </div>
      <div className="mt-2 text-[11px] text-copy-muted">{formatNumber(c.metrics.approved_count)} venda(s) · CPA {c.reliable ? money(c.metrics.cpa ?? NaN) : "—"}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link href={`/ofertas/${c.id}/resumo`} className="inline-flex h-[34px] items-center justify-center rounded bg-primary px-2 text-xs font-semibold text-white hover:bg-[var(--primary-hover)]">Resumo da oferta</Link>
        <Link href={`/ofertas/${c.id}/meta`} className="inline-flex h-[34px] items-center justify-center rounded bg-surface-hover px-2 text-xs font-semibold text-copy ring-1 ring-inset ring-input-border hover:text-white">Tráfego</Link>
      </div>
    </article>
  );
}

function OfferList({ cards, currency }: { cards: OfferCard[]; currency: string }) {
  const money = (v: number) => formatMoney(v, currency);
  return (
    <>
      {/* Celular: linha compacta (nome + lucro + ROAS) em vez da tabela larga que cortava o ROAS. */}
      <ul className="divide-y divide-divider rounded-md bg-surface md:hidden">
        {cards.map((c) => (
          <li key={c.id}>
            <Link href={`/ofertas/${c.id}/resumo`} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-copy-strong">{c.name}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-copy-muted"><StatusPill status={c.status} />{formatNumber(c.metrics.approved_count)} venda(s)</span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block text-sm font-bold tabular-nums ${profitColor(c)}`}>{c.reliable ? money(c.metrics.profit) : "—"}</span>
                <span className="block text-[11px] tabular-nums text-copy-muted">ROAS {roasText(c)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-md bg-surface md:block">
        <table className="w-full text-left text-sm text-copy">
          <thead>
            <tr className="text-xs font-semibold text-copy">
              {["Oferta", "Status", "Lucro", "Faturamento", "Gasto", "ROAS", "Margem", "Vendas", "CPA", ""].map((h, i) => (
                <th key={h || i} className={`h-11 border-b border-divider bg-app-bg px-3 py-2 ${i >= 2 && i <= 8 ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id}>
                <td className="border-b border-divider px-3 py-2"><Link href={`/ofertas/${c.id}/resumo`} className="font-medium text-copy-strong hover:underline">{c.name}</Link>{!c.reliable && hasMovement(c) && <div className="text-[11px] text-amber-300">gasto incompleto</div>}</td>
                <td className="border-b border-divider px-3 py-2"><StatusPill status={c.status} /></td>
                <td className={`border-b border-divider px-3 py-2 text-right font-semibold tabular-nums ${profitColor(c)}`}>{c.reliable ? money(c.metrics.profit) : "—"}</td>
                <td className="border-b border-divider px-3 py-2 text-right tabular-nums">{money(c.metrics.gross_revenue)}</td>
                <td className="border-b border-divider px-3 py-2 text-right tabular-nums">{c.reliable ? money(c.metrics.spend) : "—"}</td>
                <td className="border-b border-divider px-3 py-2 text-right tabular-nums">{roasText(c)}</td>
                <td className="border-b border-divider px-3 py-2 text-right tabular-nums">{marginText(c)}</td>
                <td className="border-b border-divider px-3 py-2 text-right tabular-nums">{formatNumber(c.metrics.approved_count)}</td>
                <td className="border-b border-divider px-3 py-2 text-right tabular-nums">{c.reliable ? money(c.metrics.cpa ?? NaN) : "—"}</td>
                <td className="whitespace-nowrap border-b border-divider px-3 py-2 text-xs"><Link href={`/ofertas/${c.id}/meta`} className="text-[var(--link)] hover:underline">tráfego</Link> · <Link href={`/ofertas/${c.id}/integracoes`} className="text-[var(--link)] hover:underline">integrações</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Grade de cards (ou lista) com busca, ordenação e modo de exibição. Preferências ficam só neste navegador. */
export function OfferBoard({ cards, currency }: { cards: OfferCard[]; currency: string }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<OfferSort>("lucro");
  const [view, setView] = useState<View>("cards");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null") as { sort?: string; view?: string } | null;
      // Preferência salva neste navegador: aplicada depois de montar para não divergir do HTML do servidor.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved?.sort) setSort(parseOfferSort(saved.sort));
      if (saved?.view === "lista" || saved?.view === "cards") setView(saved.view);
    } catch { /* sem armazenamento: usa o padrão */ }
  }, []);
  const remember = (next: { sort?: OfferSort; view?: View }) => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ sort: next.sort ?? sort, view: next.view ?? view }));
    } catch { /* sem armazenamento */ }
  };

  const shown = useMemo(() => {
    const term = q.trim().toLocaleLowerCase("pt-BR");
    return sortCards(term ? cards.filter((c) => c.name.toLocaleLowerCase("pt-BR").includes(term)) : cards, sort);
  }, [cards, q, sort]);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-surface p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar oferta pelo nome…" aria-label="Buscar oferta" className="h-[34px] min-w-0 flex-1 basis-48 rounded border border-input-border bg-transparent px-2.5 text-sm text-copy-strong placeholder:text-copy-muted focus:border-primary focus:outline-none" />
        <label className="flex items-center gap-2 text-xs text-copy">
          <span className="sr-only sm:not-sr-only">Ordenar</span>
          <select value={sort} onChange={(e) => { const v = parseOfferSort(e.target.value); setSort(v); remember({ sort: v }); }} className="h-[34px] rounded border border-input-border bg-app-bg px-2 text-sm text-copy-strong">
            {OFFER_SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <div className="flex rounded border border-input-border p-0.5" role="group" aria-label="Modo de exibição">
          {(["cards", "lista"] as View[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); remember({ view: v }); }} className={`h-[28px] rounded px-3 text-xs font-semibold ${view === v ? "bg-primary-active text-white" : "text-copy hover:text-white"}`}>
              {v === "cards" ? "Cards" : "Lista"}
            </button>
          ))}
        </div>
      </div>
      {!shown.length ? (
        <div className="rounded-md border border-dashed border-input-border bg-surface p-8 text-center text-sm text-copy-muted">{cards.length ? "Nenhuma oferta com esse nome." : "Nenhuma oferta nesta aba."}</div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((c) => <OfferCardView key={c.id} c={c} currency={currency} />)}
        </div>
      ) : (
        <OfferList cards={shown} currency={currency} />
      )}
    </section>
  );
}
