import { describe, expect, it } from "vitest";
import { funnelPath, funnelRatios } from "@/lib/core/funnel-shape";

describe("funnelRatios", () => {
  it("usa o % sobre a primeira etapa, com piso para a faixa nunca sumir", () => {
    expect(funnelRatios([{ fromStart: 1 }, { fromStart: 0.917 }, { fromStart: 0.044 }, { fromStart: 0 }])).toEqual([1, 0.917, 0.06, 0.06]);
  });
  it("etapa sem dado fica no piso e valor acima de 100% não passa do teto", () => {
    expect(funnelRatios([{ fromStart: null }, { fromStart: 3.4 }])).toEqual([0.06, 1]);
  });
});

describe("funnelPath", () => {
  const path = funnelPath([1, 0.5, 0.25], 300, 100);
  it("é um desenho único e fechado (sem cortes entre etapas)", () => {
    expect(path.startsWith("M 0 0 L 50 0")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path.match(/M /g)).toHaveLength(1);
  });
  it("liga as etapas por curvas, uma por trecho e por borda", () => {
    expect(path.match(/ C /g)).toHaveLength(4);
  });
  it("mantém a espessura de cada etapa no centro da sua coluna", () => {
    // 3 colunas de largura 100: centros em 50, 150 e 250; metade da espessura = ratio * 50
    expect(path).toContain("150 25 "); // borda de cima da etapa 2 (50 - 25)
    expect(path).toContain("250 37.5"); // borda de cima da etapa 3 (50 - 12.5)
  });
  it("lista vazia não gera caminho", () => {
    expect(funnelPath([], 100, 100)).toBe("");
  });
});
