import { describe, expect, it } from "vitest";
import { buildSummaryAnalytics, type SummaryOrder } from "@/lib/core/summary";

const order = (id: string, status: string, payment = "pix", extra: Partial<SummaryOrder> = {}): SummaryOrder => ({
  id,
  status,
  gross_amount: 30,
  base_amount: 30,
  payment_method: payment,
  product_name: "Produto A",
  offer_type: "main",
  paid_at: status === "paid" ? "2026-10-11T12:00:00Z" : null,
  provider_created_at: "2026-10-11T11:00:00Z",
  ...extra,
});

describe("analytics do resumo", () => {
  it("mantém vendas sem origem separadas e calcula pendentes", () => {
    const paid = [order("1", "paid"), order("2", "paid", "credit_card")];
    const attempts = [...paid, order("3", "pending")];
    const data = buildSummaryAnalytics({
      paidOrders: paid,
      attempts,
      attributions: [{ order_id: "1", utm_source: "facebook", attribution_status: "EXACT_ID" }],
      sessions: [],
      clicks: 100,
      approvedCount: 2,
    });
    expect(data.pendingCount).toBe(1);
    expect(data.pendingAmount).toBe(30);
    expect(data.salesBySource.value?.map((item) => item.label)).toEqual(["Meta Ads", "Sem identificação"]);
    expect(data.salesBySource.value?.map((item) => item.amount)).toEqual([30, 30]);
    expect(data.salesByPayment.value?.reduce((sum, item) => sum + item.amount, 0)).toBe(60);
    expect(data.funnel.state).toBe("partial");
    expect(data.funnel.stages.find((stage) => stage.key === "pageviews")?.value).toBeNull();
  });

  it("não fabrica taxa de 100% quando só existem aprovados", () => {
    const paid = [order("1", "paid")];
    const data = buildSummaryAnalytics({ paidOrders: paid, attempts: paid, attributions: [], sessions: [], clicks: 1, approvedCount: 1 });
    expect(data.approvalRate.value?.[0]).toMatchObject({ rate: null, state: "partial" });
  });

  it("não fabrica série horária com gasto diário", () => {
    const data = buildSummaryAnalytics({ paidOrders: [], attempts: [], attributions: [], sessions: [], clicks: 0, approvedCount: 0 });
    expect(data.hourlyProfit).toMatchObject({ state: "not_synced", value: null });
    expect(data.hourlyFinancial).toMatchObject({ state: "not_synced", value: null });
  });
});
