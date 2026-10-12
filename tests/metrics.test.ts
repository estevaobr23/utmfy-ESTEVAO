import { describe, expect, it } from "vitest";
import { derive, emptySums } from "@/lib/core/metrics";
import { buildTree, totals, type OrderRow, type SpendRow } from "@/lib/core/report";

const spend = (o: Partial<SpendRow>): SpendRow => ({
  account_id: "1", campaign_id: "C", campaign_name: "C", adset_id: "S", adset_name: "S", ad_id: "A", ad_name: "A",
  currency: "BRL", impressions: 1000, clicks: 20, outbound_clicks: 15, spend: 0, meta_purchases: null, ...o,
});
const orders = (o: Partial<OrderRow>): OrderRow => ({
  campaign_id: "C", campaign_name: "C", adset_id: "S", adset_name: "S", ad_id: "A", ad_name: "A", attribution_status: "EXACT_ID",
  approved_count: 0, approved_items: 0, gross_revenue: 0, fees: 0, refunded_count: 0, refunded_amount: 0, chargeback_count: 0,
  chargeback_amount: 0, refund_requested_count: 0, pix_generated: 0, pix_paid: 0, ...o,
});

describe("fórmulas centralizadas", () => {
  it("ROAS e CPA (exemplo Ad 123: R$10 gasto, 1 venda de R$32,90)", () => {
    const m = derive({ ...emptySums(), spend: 10, gross_revenue: 32.9, approved_count: 1, approved_items: 1 });
    expect(m.roas).toBeCloseTo(3.29, 2);
    expect(m.cpa).toBe(10);
    expect(m.ticket).toBe(32.9);
  });
  it("sem gasto → ROAS null (não infinito); sem venda → CPA null", () => {
    const m = derive({ ...emptySums(), gross_revenue: 100 });
    expect(m.roas).toBeNull();
    expect(m.cpa).toBeNull();
  });
  it("líquido e lucro", () => {
    const m = derive({ ...emptySums(), spend: 100, gross_revenue: 400, fees: 20, refunded_amount: 40, chargeback_amount: 35, other_costs: 10 });
    expect(m.net_revenue).toBe(305);
    expect(m.profit).toBe(195);
    expect(m.roas).toBeCloseTo(3.05);
    expect(m.gross_roas).toBeCloseTo(4);
  });
  it("conversão Pix, CTR, CPC", () => {
    const m = derive({ ...emptySums(), pix_generated: 10, pix_paid: 7, impressions: 1000, reach: 800, clicks: 25, spend: 50 });
    expect(m.pix_conversion).toBe(0.7);
    expect(m.ctr).toBe(0.025);
    expect(m.cpc).toBe(2);
    expect(m.cpm).toBe(50);
    expect(m.frequency).toBe(1.25);
  });
  it("ROI usa investimento total e margem usa receita líquida", () => {
    const m = derive({ ...emptySums(), spend: 100, other_costs: 20, gross_revenue: 300 });
    expect(m.profit).toBe(180);
    expect(m.roi).toBe(1.5);
    expect(m.margin).toBe(0.6);
  });
});

describe("árvore Campanha → Conjunto → Anúncio", () => {
  const s = [
    spend({ campaign_id: "A", campaign_name: "Campanha A", adset_id: "A1", ad_id: "a1", spend: 100 }),
    spend({ campaign_id: "A", campaign_name: "Campanha A", adset_id: "A1", ad_id: "a2", spend: 50 }),
    spend({ campaign_id: "B", campaign_name: "Campanha B", adset_id: "B1", ad_id: "b1", spend: 100 }),
  ];
  const o = [
    orders({ campaign_id: "A", adset_id: "A1", ad_id: "a1", approved_count: 6, approved_items: 6, gross_revenue: 240 }),
    orders({ campaign_id: "A", adset_id: "A1", ad_id: "a2", approved_count: 2, approved_items: 2, gross_revenue: 80 }),
    orders({ campaign_id: "B", adset_id: "B1", ad_id: "b1", approved_count: 2, approved_items: 2, gross_revenue: 70 }),
    orders({ campaign_id: null, adset_id: null, ad_id: null, attribution_status: "UNTRACKED", approved_count: 1, approved_items: 1, gross_revenue: 40 }),
  ];

  it("Campanha A: R$150 / 8 vendas / R$320 / ROAS 2,13; Campanha B: ROAS 0,70", () => {
    const tree = buildTree(s, o);
    const a = tree.find((n) => n.id === "A")!;
    const b = tree.find((n) => n.id === "B")!;
    expect(a.metrics).toMatchObject({ spend: 150, approved_count: 8, gross_revenue: 320 });
    expect(a.metrics.roas).toBeCloseTo(2.13, 2);
    expect(b.metrics.roas).toBeCloseTo(0.7, 2);
    expect(a.children[0].children.map((c) => c.id).sort()).toEqual(["a1", "a2"]);
  });
  it("venda não rastreada fica nos totais mas fora da árvore", () => {
    const t = totals(s, o);
    expect(t.gross_revenue).toBe(430);
    expect(t.untracked_count).toBe(1);
    expect(buildTree(s, o).some((n) => n.name.includes("não identificada"))).toBe(false);
  });
  it("mesma fórmula no nó e nos totais", () => {
    const t = totals(s.slice(0, 2), o.slice(0, 2));
    const a = buildTree(s.slice(0, 2), o.slice(0, 2))[0];
    expect(t.roas).toBe(a.metrics.roas);
    expect(t.cpa).toBe(a.metrics.cpa);
  });
});
