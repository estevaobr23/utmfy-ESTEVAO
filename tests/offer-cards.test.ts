import { describe, expect, it } from "vitest";
import { cardResult, dailyProfit, offersInTab, otherCostsFor, parseOfferSort, parseOfferTab, scopeSpendForOffer, scoreboard, sortCards, tabCounts, type OfferCard, type OfferScopeContext } from "@/lib/core/offer-cards";
import { derive, emptySums } from "@/lib/core/metrics";
import type { SpendRow } from "@/lib/core/report";

const spendRow = (account: string, campaign: string, adset: string, spend: number): SpendRow => ({
  account_id: account, campaign_id: campaign, campaign_name: campaign, adset_id: adset, adset_name: adset, ad_id: `${adset}-ad`, ad_name: null,
  currency: "BRL", spend, impressions: 0, clicks: 0, outbound_clicks: 0, meta_purchases: 0,
});

const card = (id: string, over: Partial<OfferCard> & { profit?: number; spend?: number; gross?: number } = {}): OfferCard => {
  const gross = over.gross ?? 100;
  const spend = over.spend ?? 50;
  // Lucro desejado: ajusta as taxas para chegar nele (receita líquida − gasto).
  const fees = over.profit == null ? 0 : gross - spend - over.profit;
  return {
    id, name: over.name ?? id, slug: id, status: over.status ?? "active",
    metrics: derive({ ...emptySums(), gross_revenue: gross, spend, fees, approved_count: gross ? 1 : 0, approved_items: gross ? 1 : 0 }),
    reliable: over.reliable ?? true, spendMessage: null, daily: null,
  };
};

describe("abas e status", () => {
  const offers = [{ status: "active" }, { status: "paused" }, { status: "archived" }, { status: "active" }];
  it("padrão = Ativas (arquivadas ficam fora até pedir)", () => {
    expect(parseOfferTab(undefined)).toBe("ativas");
    expect(parseOfferTab("xyz")).toBe("ativas");
    expect(offersInTab(offers, "ativas")).toHaveLength(2);
    expect(tabCounts(offers)).toEqual({ ativas: 2, pausadas: 1, arquivadas: 1, todas: 4 });
  });
});

describe("recorte do gasto por oferta (mesma regra do Resumo)", () => {
  const rows = [spendRow("111", "C1", "S1", 10), spendRow("111", "C2", "S2", 20), spendRow("222", "C3", "S3", 40)];
  const ctx: OfferScopeContext = {
    links: [
      { offerId: "A", accountId: "111", campaignFilter: null },
      { offerId: "B", accountId: "111", campaignFilter: null },
      { offerId: "C", accountId: "222", campaignFilter: null },
    ],
    manualBindings: [{ offerId: "A", accountId: "111", level: "campaign", objectId: "C1" }],
    pixelBindings: [{ offerId: "B", accountId: "111", level: "adset", objectId: "S2" }],
    bindingsUsable: true,
  };
  it("cada linha vai para uma oferta só; conta exclusiva sem vínculo entra inteira", () => {
    expect(scopeSpendForOffer(rows, "A", ctx).rows.map((r) => r.adset_id)).toEqual(["S1"]);
    expect(scopeSpendForOffer(rows, "B", ctx).rows.map((r) => r.adset_id)).toEqual(["S2"]);
    expect(scopeSpendForOffer(rows, "C", ctx).rows.map((r) => r.adset_id)).toEqual(["S3"]);
  });
  it("conta compartilhada sem vínculo da oferta fica pendente (gasto incompleto)", () => {
    const withD = { ...ctx, links: [...ctx.links, { offerId: "D", accountId: "111", campaignFilter: null }] };
    expect(scopeSpendForOffer(rows, "D", withD).pendingAccounts).toEqual(["111"]);
  });
  it("sem vínculos utilizáveis, volta ao modo antigo por conta/nome", () => {
    const legacy: OfferScopeContext = { links: [{ offerId: "A", accountId: "111", campaignFilter: "C2" }], manualBindings: [], pixelBindings: [], bindingsUsable: false };
    expect(scopeSpendForOffer(rows, "A", legacy).rows.map((r) => r.campaign_id)).toEqual(["C2"]);
  });
});

describe("outros custos (espelho de report_other_costs)", () => {
  const rules = [
    { offer_id: null, kind: "tax_pct", value: 10, active: true, starts_on: null, ends_on: null },
    { offer_id: "A", kind: "product_cost_per_sale", value: "2", active: true, starts_on: null, ends_on: null },
    { offer_id: "B", kind: "fixed_monthly", value: 300, active: true, starts_on: null, ends_on: null },
    { offer_id: null, kind: "fixed_monthly", value: 999, active: true, starts_on: "2027-01-01", ends_on: null },
    { offer_id: null, kind: "tax_pct", value: 50, active: false, starts_on: null, ends_on: null },
  ];
  it("regra sem oferta vale para todas; a da oferta só para ela; fixa é pró-rata (30 dias)", () => {
    expect(otherCostsFor(rules, "A", "2026-11-01", "2026-11-10", 1000, 5)).toBeCloseTo(100 + 10);
    expect(otherCostsFor(rules, "B", "2026-11-01", "2026-11-10", 1000, 5)).toBeCloseTo(100 + 100);
  });
});

describe("placar e ordenação", () => {
  const cards = [
    card("lucra", { profit: 30 }),
    card("perde", { profit: -20 }),
    card("incompleto", { profit: 500, reliable: false }),
    card("parado", { gross: 0, spend: 0 }),
    card("arquivada", { profit: 900, status: "archived" }),
  ];
  it("positivas × negativas contam só gasto confiável com movimento", () => {
    expect(cardResult(cards[2])).toBe("neutral");
    expect(cardResult(cards[3])).toBe("neutral");
    expect(scoreboard(cards)).toMatchObject({ total: 5, positive: 2, negative: 1, neutral: 2 });
  });
  it("maior lucro: confiáveis primeiro, arquivadas sempre no fim", () => {
    expect(sortCards(cards, "lucro").map((c) => c.id)).toEqual(["lucra", "parado", "perde", "incompleto", "arquivada"]);
  });
  it("maior prejuízo, nome e parse da ordenação", () => {
    expect(sortCards(cards, "prejuizo")[0].id).toBe("perde");
    expect(sortCards(cards, "nome").map((c) => c.id)).toEqual(["incompleto", "lucra", "parado", "perde", "arquivada"]);
    expect(parseOfferSort("roas")).toBe("roas");
    expect(parseOfferSort("??")).toBe("lucro");
  });
});

describe("série diária do lucro (sparkline)", () => {
  it("todos os dias do período; receita líquida do dia − gasto do dia", () => {
    const orders = [
      { offer_id: "A", day: "2026-11-01", gross_revenue: 100, fees: 10, refunded_amount: 0, chargeback_amount: 0 },
      { offer_id: "A", day: "2026-11-03", gross_revenue: "50", fees: "0", refunded_amount: "20", chargeback_amount: "0" },
      { offer_id: "B", day: "2026-11-01", gross_revenue: 999, fees: 0, refunded_amount: 0, chargeback_amount: 0 },
    ];
    const spend = [{ account_id: "1", campaign_id: "C", campaign_name: null, adset_id: "S", day: "2026-11-02", spend: 40 }];
    expect(dailyProfit("2026-11-01", "2026-11-03", "A", orders, spend)).toEqual([
      { day: "2026-11-01", profit: 90 }, { day: "2026-11-02", profit: -40 }, { day: "2026-11-03", profit: 30 },
    ]);
  });
});
