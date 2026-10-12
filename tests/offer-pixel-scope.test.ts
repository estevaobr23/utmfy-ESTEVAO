import { describe, expect, it } from "vitest";
import { adsetPixelId, deriveOfferPixelBindings, mergeBindings, type AdsetPixelRow } from "@/lib/core/offer-pixel-scope";
import { scopeOfferSpendRowsByBindings } from "@/lib/core/offer-spend-scope";
import type { SpendRow } from "@/lib/core/report";

const adset = (adsetId: string, campaignId: string, pixel: unknown): AdsetPixelRow => ({
  account_id: "999", campaign_id: campaignId, adset_id: adsetId, promoted_object: pixel === null ? null : { pixel_id: pixel, custom_event_type: "PURCHASE" },
});
const row = (campaign: string, adset: string, spend: number): SpendRow => ({
  account_id: "999", campaign_id: campaign, campaign_name: campaign, adset_id: adset, adset_name: adset, ad_id: `ad-${adset}`, ad_name: adset,
  currency: "BRL", spend, impressions: 100, clicks: 10, outbound_clicks: 8, meta_purchases: 0,
});

describe("oferta por pixel (automático)", () => {
  it("lê o pixel do promoted_object (string ou número) e ignora o resto", () => {
    expect(adsetPixelId({ pixel_id: "123456789" })).toBe("123456789");
    expect(adsetPixelId({ pixel_id: 123456789 })).toBe("123456789");
    expect(adsetPixelId({ page_id: "1" })).toBeNull();
    expect(adsetPixelId({ pixel_id: "abc" })).toBeNull();
    expect(adsetPixelId(null)).toBeNull();
  });

  it("conjunto com o pixel de uma oferta pertence a ela, inclusive campanha nova", () => {
    const { bindings } = deriveOfferPixelBindings(
      [adset("S1", "C1", "111111"), adset("S2", "C2", "222222"), adset("S3", "C3", "111111"), adset("S4", "C4", null)],
      [{ offerId: "A", pixelId: "111111" }, { offerId: "B", pixelId: "222222" }],
    );
    expect(bindings.map((b) => [b.offerId, b.objectId])).toEqual([["A", "S1"], ["B", "S2"], ["A", "S3"]]);
  });

  it("pixel repetido em duas ofertas não atribui gasto a nenhuma", () => {
    const d = deriveOfferPixelBindings([adset("S1", "C1", "111111")], [{ offerId: "A", pixelId: "111111" }, { offerId: "B", pixelId: "111111" }]);
    expect(d.bindings).toEqual([]);
    expect(d.ambiguousPixels).toEqual(["111111"]);
  });

  it("o pixel vence o vínculo manual no mesmo conjunto e o manual segue valendo sem pixel", () => {
    const merged = mergeBindings(
      [{ offerId: "B", accountId: "999", level: "adset", objectId: "S1" }, { offerId: "B", accountId: "999", level: "campaign", objectId: "C9" }],
      [{ offerId: "A", accountId: "999", level: "adset", objectId: "S1" }],
    );
    expect(merged).toEqual([{ offerId: "B", accountId: "999", level: "campaign", objectId: "C9" }, { offerId: "A", accountId: "999", level: "adset", objectId: "S1" }]);
  });

  it("o gasto de cada oferta é só o dos conjuntos com o pixel dela", () => {
    const rows = [row("C1", "S1", 10), row("C2", "S2", 20), row("C3", "S3", 30), row("C4", "S4", 40)];
    const { bindings } = deriveOfferPixelBindings(
      [adset("S1", "C1", "111111"), adset("S2", "C2", "222222"), adset("S3", "C3", "111111"), adset("S4", "C4", null)],
      [{ offerId: "A", pixelId: "111111" }, { offerId: "B", pixelId: "222222" }],
    );
    const a = scopeOfferSpendRowsByBindings(rows, "A", ["999"], bindings, ["999"]);
    const b = scopeOfferSpendRowsByBindings(rows, "B", ["999"], bindings, ["999"]);
    expect(a.rows.map((r) => r.spend)).toEqual([10, 30]);
    expect(b.rows.map((r) => r.spend)).toEqual([20]);
    expect(a.pendingAccounts).toEqual([]);
  });
});
