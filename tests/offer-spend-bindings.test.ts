import { describe, expect, it } from "vitest";
import { scopeOfferSpendRowsByBindings, type OfferMetaBinding } from "@/lib/core/offer-spend-scope";
import type { SpendRow } from "@/lib/core/report";

const row = (campaign: string, adset: string, ad: string, spend: number): SpendRow => ({
  account_id: "999",
  campaign_id: campaign,
  campaign_name: campaign,
  adset_id: adset,
  adset_name: adset,
  ad_id: ad,
  ad_name: ad,
  currency: "BRL",
  spend,
  impressions: 100,
  clicks: 10,
  outbound_clicks: 8,
  meta_purchases: 0,
});

describe("escopo de gasto por vínculo explícito", () => {
  const rows = [row("C1", "S1", "A1", 10), row("C1", "S2", "A2", 20), row("C2", "S3", "A3", 30)];
  const bindings: OfferMetaBinding[] = [
    { offerId: "offer-a", accountId: "999", level: "campaign", objectId: "C1" },
    { offerId: "offer-b", accountId: "999", level: "adset", objectId: "S2" },
  ];

  it("o conjunto mais específico vence a campanha", () => {
    expect(scopeOfferSpendRowsByBindings(rows, "offer-a", ["999"], bindings).rows.map((item) => item.ad_id)).toEqual(["A1"]);
    expect(scopeOfferSpendRowsByBindings(rows, "offer-b", ["999"], bindings).rows.map((item) => item.ad_id)).toEqual(["A2"]);
  });

  it("mantém linhas sem associação fora de todas as ofertas", () => {
    const assigned = new Set([
      ...scopeOfferSpendRowsByBindings(rows, "offer-a", ["999"], bindings).rows,
      ...scopeOfferSpendRowsByBindings(rows, "offer-b", ["999"], bindings).rows,
    ].map((item) => item.ad_id));
    expect([...assigned]).toEqual(["A1", "A2"]);
    expect(assigned.has("A3")).toBe(false);
  });

  it("sinaliza conta vinculada sem nenhum objeto confirmado", () => {
    expect(scopeOfferSpendRowsByBindings(rows, "offer-c", ["999"], bindings).pendingAccounts).toEqual(["999"]);
  });
});
