import { describe, expect, it } from "vitest";
import { cumulative, hourlyTotals, niceScale } from "@/lib/core/hourly-chart";
import { localDateHour, localHourToUtc } from "@/lib/core/dates";
import { normalizeHourlyInsight } from "@/lib/core/meta";
import type { HourlyPoint } from "@/lib/core/summary";

describe("niceScale", () => {
  it("sempre inclui o zero e usa degraus redondos", () => {
    const s = niceScale(-12, 145);
    expect(s.lo).toBeLessThanOrEqual(-12);
    expect(s.hi).toBeGreaterThanOrEqual(145);
    expect(s.ticks).toContain(0);
    expect(s.ticks.every((t) => Number.isFinite(t))).toBe(true);
  });
  it("tudo zero não gera eixo vazio", () => {
    const s = niceScale(0, 0);
    expect(s.hi).toBeGreaterThan(s.lo);
  });
  it("só negativos mantém o zero no topo", () => {
    expect(niceScale(-80, -5).hi).toBe(0);
  });
});

describe("cumulative e totais", () => {
  it("acumula na ordem das horas", () => {
    expect(cumulative([1, 2, 3, -1])).toEqual([1, 3, 6, 5]);
  });
  it("totais bruto/líquido e lucro nulo sem gasto por hora", () => {
    const point = (hour: number, gross: number, net: number, investment: number | null): HourlyPoint => ({ hour, sales: 1, grossRevenue: gross, netRevenue: net, investment, profitGross: null, profitNet: null });
    expect(hourlyTotals([point(1, 10, 8, null), point(2, 20, 16, null)], "net")).toMatchObject({ revenue: 24, investment: null, profit: null, sales: 2 });
    expect(hourlyTotals([point(1, 10, 8, 3), point(2, 20, 16, 5)], "gross")).toMatchObject({ revenue: 30, investment: 8, profit: 22 });
  });
});

describe("conversão de fuso do gasto por hora (conta em Nova York → workspace em São Paulo)", () => {
  const raw = { account_id: "act_1", campaign_id: "C", adset_id: "S", spend: "5.50", date_start: "2026-10-20", hourly_stats_aggregated_by_advertiser_time_zone: "13:00:00 - 13:59:59" };

  it("13h em NY (EDT, UTC-4) = 14h em São Paulo (UTC-3)", () => {
    expect(normalizeHourlyInsight(raw, "America/New_York", "America/Sao_Paulo")).toMatchObject({ date: "2026-10-20", hour: 14, account_id: "1", spend: 5.5 });
  });

  it("depois do fim do horário de verão de NY (EST, UTC-5) a diferença passa a 2h", () => {
    expect(normalizeHourlyInsight({ ...raw, date_start: "2026-11-02" }, "America/New_York", "America/Sao_Paulo")).toMatchObject({ date: "2026-11-02", hour: 15 });
  });

  it("22h em NY vira 23h em São Paulo, e 23h vira 00h do dia seguinte", () => {
    expect(normalizeHourlyInsight({ ...raw, hourly_stats_aggregated_by_advertiser_time_zone: "22:00:00 - 22:59:59" }, "America/New_York", "America/Sao_Paulo")).toMatchObject({ date: "2026-10-20", hour: 23 });
    expect(normalizeHourlyInsight({ ...raw, hourly_stats_aggregated_by_advertiser_time_zone: "23:00:00 - 23:59:59" }, "America/New_York", "America/Sao_Paulo")).toMatchObject({ date: "2026-10-21", hour: 0 });
  });

  it("ignora linha sem faixa de hora, sem conjunto ou com hora inválida", () => {
    expect(normalizeHourlyInsight({ ...raw, hourly_stats_aggregated_by_advertiser_time_zone: undefined }, "America/New_York", "America/Sao_Paulo")).toBeNull();
    expect(normalizeHourlyInsight({ ...raw, adset_id: undefined }, "America/New_York", "America/Sao_Paulo")).toBeNull();
    expect(normalizeHourlyInsight({ ...raw, hourly_stats_aggregated_by_advertiser_time_zone: "99:00:00" }, "America/New_York", "America/Sao_Paulo")).toBeNull();
  });

  it("sem fuso da conta usa o do workspace (nenhum deslocamento)", () => {
    expect(normalizeHourlyInsight(raw, null, "America/Sao_Paulo")).toMatchObject({ date: "2026-10-20", hour: 13 });
  });
});

describe("localHourToUtc / localDateHour", () => {
  it("ida e volta", () => {
    const d = localHourToUtc("2026-10-20", 9, "America/Sao_Paulo");
    expect(d.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(localDateHour(d, "America/Sao_Paulo")).toEqual({ date: "2026-10-20", hour: 9 });
  });
});
