// Cards de oferta (Gerenciar ofertas): regras puras e testáveis.
// O recorte do gasto por oferta repete EXATAMENTE a regra de loadReport (queries.ts), para o card bater com o Resumo
// da oferta, mas a partir de UMA leitura do gasto do workspace (antes era ~9 consultas por oferta).
import { addDays } from "./dates";
import type { Derived } from "./metrics";
import { scopeOfferSpendRows, scopeOfferSpendRowsByBindings, type OfferMetaBinding, type OfferSpendLink, type ScopeKeys } from "./offer-spend-scope";
import { mergeBindings } from "./offer-pixel-scope";

// ------------------------------------------------------------------ status --
export const OFFER_STATUS_LABEL: Record<string, string> = { active: "Ativa", paused: "Em pausa", archived: "Arquivada" };
export const offerStatusLabel = (status: string) => OFFER_STATUS_LABEL[status] ?? "Sem status";

export type OfferTab = "ativas" | "pausadas" | "arquivadas" | "todas";
export const OFFER_TABS: [OfferTab, string][] = [["ativas", "Ativas"], ["pausadas", "Em pausa"], ["arquivadas", "Arquivadas"], ["todas", "Todas"]];
const TAB_STATUS: Record<OfferTab, ((status: string) => boolean)> = {
  ativas: (s) => s === "active",
  pausadas: (s) => s === "paused",
  arquivadas: (s) => s === "archived",
  // "Todas" = tudo, com as arquivadas no fim (ver sortCards).
  todas: () => true,
};
/** Aba padrão = Ativas: arquivadas ficam fora até alguém pedir. */
export const parseOfferTab = (v: unknown): OfferTab => (OFFER_TABS.some(([key]) => key === v) ? (v as OfferTab) : "ativas");
export const offersInTab = <T extends { status: string }>(offers: T[], tab: OfferTab) => offers.filter((o) => TAB_STATUS[tab](o.status));
export const tabCounts = (offers: { status: string }[]) =>
  Object.fromEntries(OFFER_TABS.map(([key]) => [key, offersInTab(offers, key).length])) as Record<OfferTab, number>;

// ---------------------------------------------------------- escopo do gasto --
export type WorkspaceOfferLink = { offerId: string; accountId: string; campaignFilter: string | null };

export type OfferScopeContext = {
  links: WorkspaceOfferLink[];
  manualBindings: OfferMetaBinding[];
  pixelBindings: OfferMetaBinding[];
  /** false = sem a tabela de vínculos manuais E sem vínculo por pixel: volta ao modo antigo (conta/nome). */
  bindingsUsable: boolean;
};

/** Mesmo recorte de loadReport para UMA oferta, a partir das linhas do workspace inteiro. */
export function scopeSpendForOffer<T extends ScopeKeys>(rows: T[], offerId: string, ctx: OfferScopeContext) {
  const links: OfferSpendLink[] = ctx.links.filter((l) => l.offerId === offerId).map((l) => ({ accountId: l.accountId, campaignFilter: l.campaignFilter }));
  for (const accountId of new Set(ctx.pixelBindings.filter((b) => b.offerId === offerId).map((b) => b.accountId))) {
    if (!links.some((link) => link.accountId === accountId)) links.push({ accountId, campaignFilter: null });
  }
  const accountOfferIds = new Map<string, Set<string>>();
  for (const l of ctx.links) {
    const set = accountOfferIds.get(l.accountId) ?? new Set<string>();
    set.add(l.offerId);
    accountOfferIds.set(l.accountId, set);
  }
  const exclusiveAccounts = links.map((l) => l.accountId).filter((accountId) => accountOfferIds.get(accountId)?.size === 1);
  return ctx.bindingsUsable
    ? scopeOfferSpendRowsByBindings(rows, offerId, links.map((l) => l.accountId), mergeBindings(ctx.manualBindings, ctx.pixelBindings), exclusiveAccounts)
    : scopeOfferSpendRows(rows, links, exclusiveAccounts);
}

// ------------------------------------------------------------ outros custos --
export type CostRule = { offer_id: string | null; kind: string; value: number | string; active: boolean; starts_on: string | null; ends_on: string | null };

/** Espelho de utmfy.report_other_costs para UMA oferta (regras sem oferta valem para todas). */
export function otherCostsFor(rules: CostRule[], offerId: string, from: string, to: string, gross: number, sales: number): number {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  let total = 0;
  for (const r of rules) {
    if (!r.active || (r.offer_id && r.offer_id !== offerId)) continue;
    if (r.starts_on && r.starts_on > to) continue;
    if (r.ends_on && r.ends_on < from) continue;
    const v = Number(r.value) || 0;
    if (r.kind === "fixed_monthly") total += v * (days / 30);
    else if (r.kind === "variable_pct_of_revenue" || r.kind === "tax_pct" || r.kind === "gateway_fee_pct") total += (gross * v) / 100;
    else if (r.kind === "product_cost_per_sale") total += v * sales;
  }
  return total;
}

// ------------------------------------------------------------------- cards --
export type OfferCard = {
  id: string;
  name: string;
  slug: string;
  status: string;
  metrics: Derived;
  /** Gasto confiável? Sem isso lucro/ROAS/CPA/margem viram "—" (mesma regra do Resumo). */
  reliable: boolean;
  spendMessage: string | null;
  /** Lucro por dia (só com o interruptor das séries diárias e período > 1 dia). */
  daily: { day: string; profit: number }[] | null;
};

export const hasMovement = (c: OfferCard) => c.metrics.spend > 0 || c.metrics.gross_revenue > 0 || c.metrics.approved_items > 0;

/** Resultado do card: positivo, negativo, ou neutro (sem movimento / gasto incompleto / lucro zero). */
export function cardResult(c: OfferCard): "positive" | "negative" | "neutral" {
  if (!c.reliable || !hasMovement(c)) return "neutral";
  if (c.metrics.profit > 0) return "positive";
  if (c.metrics.profit < 0) return "negative";
  return "neutral";
}

export function scoreboard(cards: OfferCard[]) {
  const total = cards.length;
  const positive = cards.filter((c) => cardResult(c) === "positive").length;
  const negative = cards.filter((c) => cardResult(c) === "negative").length;
  const pct = (n: number) => (total ? n / total : 0);
  return { total, positive, negative, neutral: total - positive - negative, positivePct: pct(positive), negativePct: pct(negative) };
}

export type OfferSort = "lucro" | "faturamento" | "roas" | "gasto" | "prejuizo" | "nome";
export const OFFER_SORTS: [OfferSort, string][] = [
  ["lucro", "Maior lucro"], ["faturamento", "Maior faturamento"], ["roas", "Maior ROAS"], ["gasto", "Maior investimento"], ["prejuizo", "Maior prejuízo"], ["nome", "Nome (A–Z)"],
];
export const parseOfferSort = (v: unknown): OfferSort => (OFFER_SORTS.some(([key]) => key === v) ? (v as OfferSort) : "lucro");

/**
 * Ordena os cards. Arquivadas sempre no fim; lucro/ROAS só contam com gasto confiável (incompletos vão depois dos
 * confiáveis), para um "R$ 0 de gasto" desconhecido nunca aparecer como a oferta que mais lucra.
 */
export function sortCards(cards: OfferCard[], sort: OfferSort): OfferCard[] {
  const archived = (c: OfferCard) => (c.status === "archived" ? 1 : 0);
  const byName = (a: OfferCard, b: OfferCard) => a.name.localeCompare(b.name, "pt-BR");
  const needsSpend = sort === "lucro" || sort === "roas" || sort === "prejuizo";
  const value = (c: OfferCard): number => {
    if (sort === "faturamento") return c.metrics.gross_revenue;
    if (sort === "gasto") return c.metrics.spend;
    if (sort === "roas") return c.metrics.roas ?? -Infinity;
    if (sort === "prejuizo") return -c.metrics.profit;
    return c.metrics.profit;
  };
  return [...cards].sort((a, b) => {
    if (archived(a) !== archived(b)) return archived(a) - archived(b);
    if (sort === "nome") return byName(a, b);
    if (needsSpend && a.reliable !== b.reliable) return a.reliable ? -1 : 1;
    const diff = value(b) - value(a);
    return diff !== 0 && Number.isFinite(diff) ? diff : byName(a, b);
  });
}

// ------------------------------------------------------------ série diária --
export type DailyOrderRow = { offer_id: string; day: string; gross_revenue: number | string; fees: number | string; refunded_amount: number | string; chargeback_amount: number | string };
export type DailySpendRow = ScopeKeys & { day: string; spend: number | string };

/**
 * Lucro por dia = receita líquida do dia − gasto do dia (sem "outros custos", que são do período).
 * Todos os dias do período aparecem (dia sem nada = 0). Gasto pelo dia da conta (Nova York), vendas pelo dia do workspace.
 */
export function dailyProfit(from: string, to: string, offerId: string, orders: DailyOrderRow[], spend: DailySpendRow[]): { day: string; profit: number }[] {
  const net = new Map<string, number>();
  for (const o of orders) {
    if (o.offer_id !== offerId) continue;
    const v = Number(o.gross_revenue) - Number(o.refunded_amount) - Number(o.chargeback_amount) - Number(o.fees);
    net.set(o.day, (net.get(o.day) ?? 0) + (Number.isFinite(v) ? v : 0));
  }
  const cost = new Map<string, number>();
  for (const s of spend) cost.set(s.day, (cost.get(s.day) ?? 0) + (Number(s.spend) || 0));
  const out: { day: string; profit: number }[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) {
    out.push({ day: d, profit: Math.round(((net.get(d) ?? 0) - (cost.get(d) ?? 0)) * 100) / 100 });
  }
  return out;
}
