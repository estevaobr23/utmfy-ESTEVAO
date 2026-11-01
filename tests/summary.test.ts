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

describe("fonte: venda da Hotmart tem campanha/anúncio mas não tem utm_source", () => {
  it("conta como Meta Ads quando o motor atribuiu anúncio, e mantém 'Sem identificação' só sem evidência", () => {
    const paid = [order("1", "paid"), order("2", "paid"), order("3", "paid"), order("4", "paid")];
    const data = buildSummaryAnalytics({
      paidOrders: paid, attempts: paid, clicks: 1, approvedCount: 4, sessions: [],
      attributions: [
        { order_id: "1", utm_source: null, attribution_status: "EXACT_ID", campaign_id: "C1", campaign_name: "CBO 1.1.1", ad_id: "A1" },
        { order_id: "2", utm_source: null, attribution_status: "EXACT_ID", campaign_id: "C1", campaign_name: "CBO 1.1.1", ad_id: "A2" },
        { order_id: "3", utm_source: null, attribution_status: "UNTRACKED" },
        { order_id: "4", utm_source: "FB", attribution_status: "EXACT_ID", campaign_name: "Outra" },
      ],
    });
    expect(data.salesBySource.value?.map((item) => [item.label, item.count])).toEqual([["Meta Ads", 3], ["Sem identificação", 1]]);
    expect(data.salesByCampaign.value?.map((item) => [item.label, item.count])).toEqual([["CBO 1.1.1", 2], ["Outra", 1], ["Sem campanha identificada", 1]]);
    expect(data.salesByCampaign.state).toBe("partial");
  });

  it("orgânico e direto não viram Meta mesmo com anúncio preenchido", () => {
    const paid = [order("1", "paid"), order("2", "paid")];
    const data = buildSummaryAnalytics({
      paidOrders: paid, attempts: paid, clicks: 1, approvedCount: 2, sessions: [],
      attributions: [
        { order_id: "1", utm_source: null, attribution_status: "ORGANIC", ad_id: "A1" },
        { order_id: "2", utm_source: null, attribution_status: "DIRECT", ad_id: "A1" },
      ],
    });
    expect(data.salesBySource.value?.map((item) => item.label).sort()).toEqual(["Direto", "Orgânico"]);
  });
});

describe("vendas por produto inclui order bump e upsell", () => {
  const rows = [
    order("1", "paid", "pix", { product_name: "Front", product_external_id: "P1", offer_type: "main" }),
    order("2", "paid", "pix", { product_name: "Front", product_external_id: "P1", offer_type: "main" }),
    order("3", "paid", "pix", { product_name: "Bump A", product_external_id: "P2", offer_type: "orderbump", gross_amount: 9.9 }),
    order("4", "paid", "pix", { product_name: "Up B", product_external_id: "P3", offer_type: "upsell", gross_amount: 19.9 }),
    order("5", "paid", "pix", { product_name: "Front (nome longo)", product_external_id: "P1", offer_type: "main" }),
  ];
  const data = buildSummaryAnalytics({ paidOrders: rows, attempts: rows, attributions: [], sessions: [], clicks: 1, approvedCount: 3 });

  it("lista todos com o tipo de cada produto e junta nomes diferentes do mesmo ID", () => {
    expect(data.salesByProduct.value?.map((item) => [item.label, item.count, item.kind])).toEqual([["Front", 3, "main"], ["Bump A", 1, "orderbump"], ["Up B", 1, "upsell"]]);
    expect(data.salesByProduct.value?.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(30 * 3 + 9.9 + 19.9, 2);
  });

  it("a visão 'só principais' continua sem bump nem upsell", () => {
    expect(data.salesByMainProduct.value?.map((item) => [item.label, item.count])).toEqual([["Front", 3]]);
  });
});

describe("meios de pagamento", () => {
  it("PayPal, carteiras e transferência não caem mais em Outros", () => {
    const methods = ["PAYPAL", "MERCADO_PAGO", "NEQUI", "applepay", "BANK_TRANSFER", "CREDIT_CARD", "pix", "KLARNA"];
    const rows = methods.map((method, index) => order(String(index), "paid", method));
    const data = buildSummaryAnalytics({ paidOrders: rows, attempts: rows, attributions: [], sessions: [], clicks: 1, approvedCount: rows.length });
    const byKey = Object.fromEntries((data.salesByPayment.value ?? []).map((item) => [item.key, item.count]));
    expect(byKey).toEqual({ paypal: 1, wallet: 3, transfer: 1, card: 1, pix: 1, other: 1 });
  });
});

describe("séries por hora", () => {
  // 15:00Z e 15:30Z = 12h em São Paulo; 03:10Z do dia 12 = 00h do dia 12.
  const rows = [
    order("1", "paid", "pix", { paid_at: "2026-10-11T15:00:00Z", gross_amount: 30, fees: 3 }),
    order("2", "paid", "pix", { paid_at: "2026-10-11T15:30:00Z", gross_amount: 20, net_amount: 17 }),
    order("3", "refunded", "pix", { paid_at: "2026-10-12T03:10:00Z", gross_amount: 10, fees: 1 }),
    order("4", "paid", "pix", { paid_at: "2026-10-05T15:00:00Z", gross_amount: 99 }),
  ];
  const build = (hourly: Parameters<typeof buildSummaryAnalytics>[0]["hourly"]) =>
    buildSummaryAnalytics({ paidOrders: rows, attempts: rows, attributions: [], sessions: [], clicks: 1, approvedCount: 4, hourly, timezone: "America/Sao_Paulo" });

  it("sem gasto por hora mostra só o faturamento e avisa", () => {
    const data = build({ spendByHour: null, from: null });
    expect(data.hourlyProfit.state).toBe("partial");
    expect(data.hourlyProfit.note).toContain("Gasto por hora ainda não sincronizado");
    expect(data.hourlyProfit.value![12]).toMatchObject({ sales: 3, grossRevenue: 149, investment: null, profitGross: null });
  });

  it("com gasto por hora calcula bruto e líquido e respeita o primeiro dia coberto", () => {
    const spend = Array.from({ length: 24 }, () => 0);
    spend[12] = 10;
    spend[0] = 4;
    const data = build({ spendByHour: spend, from: "2026-10-11", note: "aviso de cobertura" });
    expect(data.hourlyProfit).toMatchObject({ state: "available", note: "aviso de cobertura" });
    const points = data.hourlyProfit.value!;
    // 12h: 30 + 20 (o dia 05 fica de fora por ser anterior ao gasto por hora)
    expect(points[12]).toMatchObject({ sales: 2, grossRevenue: 50, netRevenue: 44, investment: 10, profitGross: 40, profitNet: 34 });
    // 00h do dia 12: pedido reembolsado → líquido = -taxa
    expect(points[0]).toMatchObject({ sales: 1, grossRevenue: 10, netRevenue: -1, investment: 4, profitGross: 6, profitNet: -5 });
    expect(data.hourlyFinancial).toBe(data.hourlyProfit);
  });

  it("sem atividade nenhuma", () => {
    const empty = buildSummaryAnalytics({ paidOrders: [], attempts: [], attributions: [], sessions: [], clicks: 0, approvedCount: 0, hourly: { spendByHour: null, from: null } });
    expect(empty.hourlyProfit.state).toBe("no_activity");
  });
});

describe("funil: só visitas vindas de anúncio da Meta", () => {
  it("isMetaSession aceita utm_source da Meta e fbclid/fbc, e recusa acesso direto", async () => {
    const { isMetaSession } = await import("@/lib/core/summary");
    expect(isMetaSession({ pageviews: 1, checkout_clicks: 0, utm_source: "FB" })).toBe(true);
    expect(isMetaSession({ pageviews: 1, checkout_clicks: 0, fbclid: "abc" })).toBe(true);
    expect(isMetaSession({ pageviews: 1, checkout_clicks: 0, fbc: "fb.1.1.abc" })).toBe(true);
    expect(isMetaSession({ pageviews: 1, checkout_clicks: 0, utm_source: null, fbclid: null })).toBe(false);
    expect(isMetaSession({ pageviews: 1, checkout_clicks: 0, utm_source: "google" })).toBe(false);
  });

  it("explica quando há mais visitas que cliques da Meta (anúncio ainda sem entrega)", async () => {
    const { buildSummaryAnalytics } = await import("@/lib/core/summary");
    const out = buildSummaryAnalytics({ paidOrders: [], attempts: [], attributions: [], sessions: [{ pageviews: 5, checkout_clicks: 2 }], clicks: 0, approvedCount: 0 });
    expect(out.funnel.note).toContain("cliques ainda não chegaram");
    const ok = buildSummaryAnalytics({ paidOrders: [], attempts: [], attributions: [], sessions: [{ pageviews: 5, checkout_clicks: 2 }], clicks: 50, approvedCount: 0 });
    expect(ok.funnel.note).toBeNull();
  });
});
