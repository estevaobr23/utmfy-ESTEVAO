import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HourlyFinancialCard, HourlyProfitCard } from "@/components/summary/hourly-charts";
import { SummaryAnalyticsGrid } from "@/components/summary/analytics-grid";
import { buildSummaryAnalytics, type HourlyPoint, type MetricDatum } from "@/lib/core/summary";

const points = (withSpend: boolean, fill: (hour: number) => number = (hour) => (hour % 5 === 0 ? 40 : 0)): HourlyPoint[] =>
  Array.from({ length: 24 }, (_, hour) => {
    const revenue = fill(hour);
    const investment = withSpend ? 6 + (hour % 3) : null;
    return { hour, sales: revenue ? 1 : 0, grossRevenue: revenue, netRevenue: revenue * 0.9, investment, profitGross: investment == null ? null : revenue - investment, profitNet: investment == null ? null : revenue * 0.9 - investment };
  });

const datum = (value: HourlyPoint[] | null, state: MetricDatum<HourlyPoint[]>["state"] = "available", note?: string): MetricDatum<HourlyPoint[]> => ({ state, value, note });

const render = (component: typeof HourlyProfitCard, d: MetricDatum<HourlyPoint[]>) => renderToStaticMarkup(createElement(component, { datum: d, currency: "BRL" }));

describe("render dos gráficos por hora", () => {
  for (const [name, component] of [["Lucro por horário", HourlyProfitCard], ["Faturamento × Investimento × Lucro", HourlyFinancialCard]] as const) {
    it(`${name}: com gasto por hora desenha 24 horas e nenhum NaN`, () => {
      const html = render(component, datum(points(true)));
      expect(html).toContain("<svg");
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("Infinity");
      expect(html).toContain("Líquido");
      expect(html).toContain("Bruto");
    });

    it(`${name}: só faturamento (sem gasto por hora) avisa e não quebra`, () => {
      const html = render(component, datum(points(false), "partial", "Gasto por hora ainda não sincronizado"));
      expect(html).toContain("Gasto por hora ainda não sincronizado");
      expect(html).not.toContain("NaN");
    });

    it(`${name}: tudo zero e prejuízo não geram NaN`, () => {
      expect(render(component, datum(points(true, () => 0)))).not.toContain("NaN");
      expect(render(component, datum(points(true, () => 1)))).not.toContain("NaN");
    });

    it(`${name}: indisponível e sem atividade têm estado próprio`, () => {
      expect(render(component, datum(null, "not_synced", "sem dados"))).toContain("Dados indisponíveis");
      expect(render(component, datum(points(false), "no_activity"))).toContain("Sem atividade");
    });
  }

  it("a grade inteira renderiza com produtos (bump com selo), fontes e campanhas", () => {
    const order = (id: string, offer_type: string, name: string) => ({
      id, status: "paid", gross_amount: 30, base_amount: 30, payment_method: "PAYPAL", product_name: name, offer_type,
      paid_at: "2026-10-11T15:00:00Z", provider_created_at: "2026-10-11T14:00:00Z",
    });
    const rows = [order("1", "main", "Front"), order("2", "orderbump", "Bump A")];
    const data = buildSummaryAnalytics({
      paidOrders: rows, attempts: rows, clicks: 1, approvedCount: 1, sessions: [],
      attributions: [{ order_id: "1", utm_source: null, attribution_status: "EXACT_ID", campaign_name: "CBO", ad_id: "A" }],
      hourly: { spendByHour: Array.from({ length: 24 }, (_, hour) => (hour === 12 ? 5 : 0)), from: "2026-10-01" },
    });
    const html = renderToStaticMarkup(createElement(SummaryAnalyticsGrid, { data, currency: "BRL" }));
    expect(html).toContain("Bump A");
    expect(html).toContain(">Bump<");
    expect(html).toContain("PayPal");
    expect(html).toContain("Meta Ads");
    expect(html).not.toContain("NaN");
  });
});
