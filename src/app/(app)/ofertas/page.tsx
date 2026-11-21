import Link from "next/link";
import { createOffer } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { OfferBoard } from "@/components/offers/offer-board";
import { PeriodControl } from "@/components/period-control";
import { PeriodBadge } from "@/components/report";
import { Card, Field, inputCls, PageHeader } from "@/components/ui";
import { OFFER_TABS, offersInTab, parseOfferTab, scoreboard, tabCounts } from "@/lib/core/offer-cards";
import { formatMoney, formatPct } from "@/lib/core/money";
import { loadOfferCards } from "@/lib/offer-cards";
import { withSavedPeriod } from "@/lib/period-cookie";
import { listOffers, parseFilters } from "@/lib/queries";
import { requireWorkspace } from "@/lib/session";

function ScoreBox({ tone, title, count, total, pct }: { tone: "good" | "bad"; title: string; count: number; total: number; pct: number }) {
  const color = tone === "good" ? "var(--success)" : "var(--danger)";
  const text = tone === "good" ? "text-success" : "text-danger-accessible";
  return (
    <div className="rounded-md bg-surface p-4 ring-1 ring-inset" style={{ ["--tw-ring-color" as string]: `color-mix(in srgb, ${color} 30%, transparent)` }}>
      <div className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${text}`}><span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />{title}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="tabular-nums"><span className={`text-3xl font-bold ${text}`}>{count}</span> <span className="text-sm text-copy-muted">de {total}</span></div>
        <div className={`text-lg font-bold tabular-nums ${text}`}>{formatPct(pct, 1)}</div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-app-bg" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count} aria-label={title}>
        <div className="h-full rounded-full" style={{ width: `${Math.round(pct * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export default async function OffersPage({ searchParams }: PageProps<"/ofertas">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  const tab = parseOfferTab(typeof sp.aba === "string" ? sp.aba : null);
  const f = parseFilters(await withSavedPeriod(sp), s.workspace.timezone);
  const offers = await listOffers(s.sb, s.workspace.id);
  const counts = tabCounts(offers);
  const cards = await loadOfferCards(s.sb, s.workspace, f, offersInTab(offers, tab));
  const score = scoreboard(cards);
  const reliable = cards.filter((c) => c.reliable);
  const totalProfit = reliable.reduce((a, c) => a + c.metrics.profit, 0);
  const totalSpend = reliable.reduce((a, c) => a + c.metrics.spend, 0);
  const totalRevenue = cards.reduce((a, c) => a + c.metrics.gross_revenue, 0);
  const money = (v: number) => formatMoney(v, s.workspace.currency);
  // Trocar de aba mantém o período em uso.
  const period = f.preset === "custom" ? `&from=${f.from}&to=${f.to}` : `&preset=${f.preset}`;

  return (
    <>
      <PageHeader
        title="Gerenciar ofertas"
        subtitle="Cada oferta é uma operação independente: produtos, campanhas Meta, pixel e números próprios. Mesmas regras do Resumo de cada oferta."
        actions={s.canWrite ? <a href="#nova" className="inline-flex h-[34px] items-center rounded bg-primary px-3 text-sm font-semibold text-white hover:bg-[var(--primary-hover)]">+ Nova oferta</a> : undefined}
      />
      <Flash sp={sp} />

      <form method="get" action="/ofertas" className="mb-3 flex flex-wrap items-end gap-2 rounded-md bg-surface p-3">
        <input type="hidden" name="aba" value={tab} />
        <PeriodControl
          key={`${f.preset}|${f.from}|${f.to}`}
          preset={f.preset}
          from={f.from}
          to={f.to}
          labelClassName="min-w-36 text-[11px] font-medium text-copy"
          selectClassName={`${inputCls} mt-1 block w-full bg-app-bg`}
          inputClassName={`${inputCls} mt-1 block w-full`}
        />
        <button className="h-[34px] rounded bg-primary px-4 text-sm font-semibold text-white hover:bg-[var(--primary-hover)]">Aplicar</button>
        <span className="ml-auto self-center text-xs text-copy-muted"><PeriodBadge f={f} /></span>
      </form>

      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <ScoreBox tone="good" title="Ofertas positivas" count={score.positive} total={score.total} pct={score.positivePct} />
        <ScoreBox tone="bad" title="Ofertas negativas" count={score.negative} total={score.total} pct={score.negativePct} />
        <div className="rounded-md bg-surface p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-copy-muted">Resultado da aba</div>
          <div className={`mt-2 text-3xl font-bold tabular-nums ${totalProfit > 0 ? "text-success" : totalProfit < 0 ? "text-danger-accessible" : "text-copy-strong"}`}>{money(totalProfit)}</div>
          <div className="mt-1 text-xs text-copy-muted">Faturamento {money(totalRevenue)} · gasto {money(totalSpend)}{score.neutral > 0 && ` · ${score.neutral} sem movimento ou com gasto incompleto`}</div>
        </div>
      </div>

      <nav aria-label="Status das ofertas" className="mb-3 flex flex-wrap gap-2">
        {OFFER_TABS.map(([key, label]) => (
          <Link key={key} href={`/ofertas?aba=${key}${period}`} aria-current={key === tab ? "page" : undefined} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${key === tab ? "bg-primary-active text-white ring-primary" : "bg-surface text-copy ring-input-border hover:text-white"}`}>
            {label}<span className={`rounded-full px-1.5 text-[10px] ${key === tab ? "bg-white/20" : "bg-app-bg"}`}>{counts[key]}</span>
          </Link>
        ))}
      </nav>

      {offers.length === 0 ? (
        <div className="rounded-md border border-dashed border-input-border bg-surface p-8 text-center text-sm text-copy-muted">Nenhuma oferta ainda. Crie a primeira abaixo.</div>
      ) : (
        <OfferBoard cards={cards} currency={s.workspace.currency} />
      )}

      {s.canWrite && (
        <div id="nova" className="mt-6 max-w-xl scroll-mt-4">
          <Card title="Nova oferta">
            <form action={createOffer} className="flex flex-wrap items-end gap-3">
              <Field label="Nome"><input name="name" required maxLength={120} placeholder="Ex.: 60 Projetos de Calistenia" className={inputCls} /></Field>
              <Field label="Slug (opcional)"><input name="slug" maxLength={60} placeholder="calistenia" className={inputCls} /></Field>
              <SubmitButton>Criar oferta</SubmitButton>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
