import { describe, expect, it } from "vitest";
import { latestBudgetChanges, parseBudgetSnapshot } from "@/lib/core/meta-metrics";

describe("latestBudgetChanges", () => {
  it("guarda só a mudança mais recente de cada objeto, na moeda do painel", () => {
    const m = latestBudgetChanges([
      { created_at: "2026-10-15T10:00:00Z", context: { object_id: "C1", before_target: 49.99, after_target: 80, workspace_currency: "BRL" } },
      { created_at: "2026-10-15T12:00:00Z", context: { object_id: "C1", before_target: 80, after_target: 120, workspace_currency: "BRL" } },
      { created_at: "2026-10-15T11:00:00Z", context: { object_id: "S1", before_target: 20, after_target: 30 } },
    ]);
    expect(m.get("C1")).toEqual({ at: "2026-10-15T12:00:00Z", before: 80, after: 120, currency: "BRL", snapshot: null });
    expect(m.get("S1")?.after).toBe(30);
  });

  it("sem os valores já convertidos, refaz a conta com a unidade menor e o câmbio", () => {
    const m = latestBudgetChanges([{ created_at: "2026-10-15T10:00:00Z", context: { object_id: "C1", before_minor: 991, rate: 5.0441, requested: 120 } }]);
    expect(m.get("C1")?.before).toBeCloseTo(49.99, 1);
    expect(m.get("C1")?.after).toBe(120);
  });

  it("ignora log sem objeto ou sem valores", () => {
    expect(latestBudgetChanges([{ created_at: "2026-10-15T10:00:00Z", context: { before_target: 1 } }, { created_at: "2026-10-15T10:00:00Z", context: null }]).size).toBe(0);
  });
});

describe("foto de lucro/ROI na mudança de orçamento", () => {
  it("lê a foto do log junto com a mudança", () => {
    const m = latestBudgetChanges([{ created_at: "2026-10-15T12:00:00Z", context: { object_id: "C1", before_target: 49.99, after_target: 120, snapshot: { profit: 62.08, roi: 3.33, roas: 4.33, spend: 18.66, sales: 3, period: "Hoje" } } }]);
    expect(m.get("C1")?.snapshot).toEqual({ profit: 62.08, roi: 3.33, roas: 4.33, spend: 18.66, sales: 3, period: "Hoje" });
  });
  it("mudança antiga, sem foto, continua funcionando", () => {
    const m = latestBudgetChanges([{ created_at: "2026-10-15T12:00:00Z", context: { object_id: "C1", before_target: 10, after_target: 20 } }]);
    expect(m.get("C1")?.snapshot).toBeNull();
    expect(m.get("C1")?.after).toBe(20);
  });
  it("só aceita números finitos e texto curto (vem do navegador)", () => {
    expect(parseBudgetSnapshot({ profit: "1e9", roi: Number.NaN, roas: Infinity })).toBeNull();
    expect(parseBudgetSnapshot(null)).toBeNull();
    const s = parseBudgetSnapshot({ profit: -53.38, roi: null, roas: 0, period: "x".repeat(100) });
    expect(s?.profit).toBe(-53.38);
    expect(s?.roas).toBe(0);
    expect(s?.period).toHaveLength(40);
  });
});
