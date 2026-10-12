import { describe, expect, it } from "vitest";
import { normalizeInsight, type RawInsight } from "@/lib/core/meta";
import { attachPixelEvents, pixelFunnelOf, spendToSums, type SpendRow } from "@/lib/core/report";
import { buildSummaryAnalytics } from "@/lib/core/summary";
import { addSums, derive, emptySums } from "@/lib/core/metrics";

const raw = (actions?: { action_type: string; value: string }[]): RawInsight => ({
  account_id: "act_1", campaign_id: "C1", adset_id: "S1", ad_id: "A1", date_start: "2026-10-12", impressions: "100", clicks: "10", spend: "1.5", actions,
} as RawInsight);

const row = (p: Partial<SpendRow> = {}): SpendRow => ({
  account_id: "1", campaign_id: "C1", campaign_name: "c", adset_id: "S1", adset_name: "s", ad_id: "A1", ad_name: "a",
  currency: "BRL", impressions: 100, clicks: 10, outbound_clicks: 8, spend: 10, meta_purchases: 0, ...p,
});

describe("eventos do pixel vindos da Meta (actions)", () => {
  it("lê visualização de página e início de checkout", () => {
    const r = normalizeInsight(raw([{ action_type: "landing_page_view", value: "21" }, { action_type: "initiate_checkout", value: "23" }]));
    expect(r).toMatchObject({ landing_page_views: 21, initiate_checkouts: 23 });
  });
  it("não conta o IC duas vezes quando a Meta lista os tipos sobrepostos", () => {
    const r = normalizeInsight(raw([{ action_type: "initiate_checkout", value: "5" }, { action_type: "omni_initiated_checkout", value: "5" }]));
    expect(r?.initiate_checkouts).toBe(5);
  });
  it("sem a ação no dia é 0 (a Meta omite o que não aconteceu)", () => {
    expect(normalizeInsight(raw([]))).toMatchObject({ landing_page_views: 0, initiate_checkouts: 0 });
    expect(normalizeInsight(raw(undefined))).toMatchObject({ landing_page_views: 0, initiate_checkouts: 0 });
  });
});

describe("pixel no relatório", () => {
  it("junta por conta|campanha|conjunto|anúncio e soma só o que foi coletado", () => {
    const rows = attachPixelEvents([row(), row({ ad_id: "A2" })], [{ account_id: "1", campaign_id: "C1", adset_id: "S1", ad_id: "A1", landing_page_views: "7", initiate_checkouts: 3 }]);
    expect(pixelFunnelOf(rows)).toEqual({ pageviews: 7, checkouts: 3 });
  });
  it("sem nenhuma linha coletada → null (funil cai no tracker, tabela mostra N/D)", () => {
    expect(pixelFunnelOf([row()])).toBeNull();
    expect(attachPixelEvents([row()], null)).toEqual([row()]);
  });
  it("CPV/CPI recalculados a partir das somas", () => {
    const sums = [row({ landing_page_views: 4, initiate_checkouts: 2 }), row({ ad_id: "A2", landing_page_views: 6, initiate_checkouts: 3 })]
      .reduce((t, r) => addSums(t, spendToSums(r)), emptySums());
    const d = derive(sums);
    expect(d).toMatchObject({ landing_page_views: 10, initiate_checkouts: 5, pixel_rows: 2 });
    expect(d.cpv).toBe(2);
    expect(d.cpi).toBe(4);
  });
});

describe("funil do resumo", () => {
  const base = { paidOrders: [], attempts: [], attributions: [], sessions: [], clicks: 25, approvedCount: 2 };
  it("usa o pixel da Meta (21 visitas, 23 ICs) quando coletado", () => {
    const f = buildSummaryAnalytics({ ...base, metaPixel: { pageviews: 21, checkouts: 23 } }).funnel;
    expect(f.stages.map((s) => s.value)).toEqual([25, 21, 23, 0, 2]);
    expect(f.state).toBe("available");
  });
  it("sem pixel nem sessões, visitas e ICs ficam N/D (null)", () => {
    const f = buildSummaryAnalytics({ ...base, metaPixel: null }).funnel;
    expect(f.stages[1].value).toBeNull();
    expect(f.state).toBe("partial");
  });
});
