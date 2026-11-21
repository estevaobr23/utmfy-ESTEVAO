import { describe, expect, it } from "vitest";
import { decodePeriod, encodePeriod, urlHasPeriod, withPeriod } from "@/lib/core/period-memory";
import { parseFilters } from "@/lib/queries";

describe("período lembrado entre telas (bug: voltava para 'Hoje')", () => {
  it("codifica preset e intervalo personalizado; recusa lixo", () => {
    expect(encodePeriod({ preset: "month" })).toBe("month");
    expect(encodePeriod({ preset: "custom", from: "2026-11-01", to: "2026-11-20" })).toBe("2026-11-01_2026-11-20");
    expect(encodePeriod({ preset: "custom", from: "2026-11-20", to: "2026-11-01" })).toBeNull();
    expect(encodePeriod({ preset: "hack" })).toBeNull();
    expect(decodePeriod("7d")).toEqual({ preset: "7d" });
    expect(decodePeriod("2026-11-01_2026-11-20")).toEqual({ from: "2026-11-01", to: "2026-11-20" });
    expect(decodePeriod("2026-11-20_2026-11-01")).toBeNull();
    expect(decodePeriod("<script>")).toBeNull();
    expect(decodePeriod(undefined)).toBeNull();
  });

  it("a URL sempre vence o cookie", () => {
    expect(urlHasPeriod({ preset: "today" })).toBe(true);
    expect(urlHasPeriod({ from: "2026-11-01", to: "2026-11-02" })).toBe(true);
    expect(urlHasPeriod({ campaign: "1" })).toBe(false);
    expect(withPeriod({ preset: "today" }, "month")).toEqual({ preset: "today" });
  });

  it("sem período na URL, usa o lembrado e mantém os outros filtros", () => {
    expect(withPeriod({ campaign: "123" }, "month")).toEqual({ campaign: "123", preset: "month" });
    expect(withPeriod({}, "2026-11-01_2026-11-20")).toEqual({ preset: "custom", from: "2026-11-01", to: "2026-11-20" });
    expect(withPeriod({}, "lixo")).toEqual({});
  });

  it("parseFilters aplica o período lembrado (o filtro mostrado = o filtro aplicado)", () => {
    const f = parseFilters(withPeriod({}, "2026-11-01_2026-11-20"), "America/Sao_Paulo");
    expect([f.preset, f.from, f.to]).toEqual(["custom", "2026-11-01", "2026-11-20"]);
    expect(parseFilters(withPeriod({}, "7d"), "America/Sao_Paulo").preset).toBe("7d");
  });
});
