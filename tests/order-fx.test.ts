import { describe, expect, it } from "vitest";
import { convertOrders, fxFactor } from "../src/lib/core/order-fx";

const rates = [
  { currency: "USD", date: "2026-10-28", rate: 5.342 },
  { currency: "USD", date: "2026-10-27", rate: 5.3346 },
];

describe("fxFactor", () => {
  it("mesma moeda ou sem moeda = 1", () => {
    expect(fxFactor("BRL", "2026-10-29", "BRL", rates)).toBe(1);
    expect(fxFactor(null, "2026-10-29", "BRL", rates)).toBe(1);
  });
  it("usa a última cotação até 7 dias antes (fim de semana/feriado)", () => {
    expect(fxFactor("USD", "2026-10-29", "BRL", rates)).toBe(5.342);
    expect(fxFactor("USD", "2026-10-27", "BRL", rates)).toBe(5.3346);
  });
  it("sem cotação ou fora da janela = null", () => {
    expect(fxFactor("USD", "2026-11-20", "BRL", rates)).toBeNull();
    expect(fxFactor("MXN", "2026-10-29", "BRL", rates)).toBeNull();
    expect(fxFactor("USD", "2026-10-29", "EUR", rates)).toBeNull();
  });
});

describe("convertOrders", () => {
  const base = { base_amount: 12, provider_created_at: null };
  it("converte USD para BRL no dia do pagamento (fuso do workspace) e mantém BRL", () => {
    const out = convertOrders([
      { ...base, currency: "USD", gross_amount: 12.99, paid_at: "2026-10-29T11:12:50Z" },
      { ...base, currency: "BRL", gross_amount: 29.9, paid_at: "2026-10-29T11:12:50Z" },
    ], "BRL", rates, "America/Sao_Paulo");
    expect(out.map((o) => o.gross_amount)).toEqual([69.39, 29.9]);
    expect(out[0].base_amount).toBe(64.1);
  });
  it("descarta pedido sem cotação", () => {
    expect(convertOrders([{ ...base, currency: "MXN", gross_amount: 100, paid_at: "2026-10-29T11:12:50Z" }], "BRL", rates, "America/Sao_Paulo")).toEqual([]);
  });
});
