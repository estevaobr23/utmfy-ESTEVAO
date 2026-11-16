import { describe, expect, it } from "vitest";
import { estimateHourlyFill } from "../src/lib/core/hourly-estimate";

const hours = [2, 3, 4, 5].map((hour) => ({ date: "2026-11-16", hour }));
const daily = [{ adset_id: "A", campaign_id: "C", campaign_name: "camp", spend: 4, clicks: 8, impressions: 101, currency: "USD" }];

describe("estimateHourlyFill", () => {
  it("espalha o gasto do dia nas horas ainda não lançadas e fecha a soma exata", () => {
    const rows = estimateHourlyFill("1", hours, daily, [], new Map());
    expect(rows).toHaveLength(4);
    expect(rows.reduce((a, r) => a + r.spend, 0)).toBeCloseTo(4, 5);
    expect(rows.reduce((a, r) => a + r.impressions, 0)).toBe(101);
  });
  it("só lança a diferença, a partir da hora seguinte ao último lançamento", () => {
    const existing = [{ date: "2026-11-16", hour: 2, adset_id: "A", spend: 1, clicks: 2, impressions: 20 }, { date: "2026-11-16", hour: 3, adset_id: "A", spend: 1, clicks: 2, impressions: 20 }];
    const rows = estimateHourlyFill("1", hours, daily, existing, new Map([["A", 1]]));
    expect(rows.map((r) => r.hour)).toEqual([4, 5]);
    expect(rows.reduce((a, r) => a + r.spend, 0)).toBeCloseTo(2, 5);
  });
  it("não lança nada quando as horas já somam o gasto do dia (horas reais da Meta)", () => {
    const existing = hours.map((h) => ({ ...h, adset_id: "A", spend: 1, clicks: 2, impressions: 26 }));
    expect(estimateHourlyFill("1", hours, daily, existing, new Map([["A", 3]]))).toEqual([]);
  });
  it("soma à hora atual quando ela já tinha lançamento", () => {
    const existing = [{ date: "2026-11-16", hour: 5, adset_id: "A", spend: 3, clicks: 6, impressions: 90 }];
    const rows = estimateHourlyFill("1", hours, daily, existing, new Map([["A", 3]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hour: 5, spend: 4, clicks: 8, impressions: 101 });
  });
});
