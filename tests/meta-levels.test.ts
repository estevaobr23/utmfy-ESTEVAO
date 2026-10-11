import { describe, expect, it } from "vitest";
import { aggregateLevel } from "@/lib/core/meta-levels";
import type { OrderRow, SpendRow } from "@/lib/core/report";

const sp = (c: string, s: string, a: string, spend: number, acc = "1"): SpendRow => ({
  account_id: acc, campaign_id: c, campaign_name: `C ${c}`, adset_id: s, adset_name: `S ${s}`, ad_id: a, ad_name: `A ${a}`,
  currency: "BRL", impressions: 100, clicks: 10, outbound_clicks: 5, spend, meta_purchases: null,
});
const od = (c: string | null, s: string | null, a: string | null, gross: number): OrderRow => ({
  campaign_id: c, campaign_name: c && `C ${c}`, adset_id: s, adset_name: s && `S ${s}`, ad_id: a, ad_name: a && `A ${a}`,
  attribution_status: c ? "EXACT_ID" : "UNTRACKED", approved_count: 1, approved_items: 1, gross_revenue: gross, fees: 0,
  refunded_count: 0, refunded_amount: 0, chargeback_count: 0, chargeback_amount: 0, refund_requested_count: 0, pix_generated: 0, pix_paid: 0,
});

const spend = [sp("A", "A1", "a1", 10), sp("A", "A2", "a2", 5), sp("B", "B1", "b1", 20, "2")];
const orders = [od("A", "A1", "a1", 35), od("B", "B1", "b1", 30), od(null, null, null, 40)];

describe("níveis do Meta Ads", () => {
  it("campanhas: uma linha por campanha e total igual à soma das linhas", () => {
    const { rows, total } = aggregateLevel("campanhas", spend, orders);
    expect(rows.map((r) => r.id)).toEqual(["B", "A"]);
    expect(rows.find((r) => r.id === "A")!.metrics).toMatchObject({ spend: 15, gross_revenue: 35, approved_count: 1 });
    expect(total).toMatchObject({ spend: 35, gross_revenue: 65, approved_count: 2 }); // venda sem campanha fora
  });
  it("conjuntos de uma campanha", () => {
    const { rows } = aggregateLevel("conjuntos", spend, orders, { campaign: "A" });
    expect(rows.map((r) => r.id).sort()).toEqual(["A1", "A2"]);
  });
  it("anúncios de um conjunto", () => {
    expect(aggregateLevel("anuncios", spend, orders, { adset: "A1" }).rows.map((r) => r.id)).toEqual(["a1"]);
  });
  it("contas: vendas herdam a conta pela campanha", () => {
    const { rows } = aggregateLevel("contas", spend, orders);
    expect(rows.find((r) => r.id === "2")!.metrics).toMatchObject({ spend: 20, gross_revenue: 30 });
  });
  it("filtro por nome", () => {
    expect(aggregateLevel("campanhas", spend, orders, { name: "c a" }).rows.map((r) => r.id)).toEqual(["A"]);
  });
});
