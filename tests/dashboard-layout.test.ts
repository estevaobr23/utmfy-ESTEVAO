import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, moveBlock, normalizeLayout, setHidden, setSpan, shiftBlock } from "@/lib/core/dashboard-layout";
import { paymentByKey, paymentMethod, prettifyMethod } from "@/lib/core/payment-methods";

const ids = (layout: { id: string }[]) => layout.map((item) => item.id);

describe("layout do painel", () => {
  it("sem nada salvo usa o padrão (cópia, não a mesma referência)", () => {
    const layout = normalizeLayout(null);
    expect(layout).toEqual(DEFAULT_LAYOUT);
    expect(layout[0]).not.toBe(DEFAULT_LAYOUT[0]);
  });

  it("descarta bloco desconhecido/repetido, corrige largura e acrescenta bloco novo na posição padrão", () => {
    const layout = normalizeLayout([
      { id: "payment", span: 6, hidden: true },
      { id: "xss<script>", span: 4 },
      { id: "payment", span: 12 },
      { id: "kpis", span: 7 },
    ]);
    expect(layout[0]).toEqual({ id: "payment", span: 6, hidden: true });
    expect(layout.find((item) => item.id === "kpis")).toEqual({ id: "kpis", span: 12, hidden: false });
    expect(new Set(ids(layout))).toEqual(new Set(ids(DEFAULT_LAYOUT)));
    expect(layout).toHaveLength(DEFAULT_LAYOUT.length);
  });

  it("move, sobe/desce entre visíveis, muda largura e oculta", () => {
    let layout = normalizeLayout(null);
    layout = moveBlock(layout, "hourly-financial", "kpis");
    expect(ids(layout)[0]).toBe("hourly-financial");
    layout = shiftBlock(layout, "hourly-financial", 1);
    expect(ids(layout).slice(0, 2)).toEqual(["kpis", "hourly-financial"]);
    expect(shiftBlock(layout, "kpis", -1)).toBe(layout);
    layout = setHidden(layout, "funnel", true);
    // "funnel" oculto é pulado: descer o 2º visível troca com o próximo visível
    const before = ids(layout.filter((item) => !item.hidden));
    const after = ids(shiftBlock(layout, "hourly-financial", 1).filter((item) => !item.hidden));
    expect(after.indexOf("hourly-financial")).toBe(before.indexOf("hourly-financial") + 1);
    expect(setSpan(layout, "payment", 8).find((item) => item.id === "payment")?.span).toBe(8);
  });
});

describe("catálogo de meios de pagamento: nunca 'Outros'", () => {
  it("todos os meios que já chegaram em produção têm nome próprio", () => {
    const seen = ["pix", "credit_card", "CREDIT_CARD", "PAYPAL", "MERCADO_PAGO", "CASHPAYMENT", "applepay", "googlepay", "picpay", "NEQUI", "nequi", "BANK_TRANSFER", "MACH_PAY", "KLARNA", "mercadopago_wallet"];
    const labels = seen.map((raw) => paymentMethod(raw).label);
    expect(labels).not.toContain("Outros");
    expect(seen.every((raw) => !paymentMethod(raw).key.startsWith("raw:"))).toBe(true);
    expect(paymentMethod("CASHPAYMENT").label).toBe("Dinheiro (OXXO / Efecty)");
    expect(paymentMethod("mercadopago_wallet").key).toBe(paymentMethod("MERCADO_PAGO").key);
  });

  it("meio desconhecido aparece com o nome da plataforma, legível; vazio = Não informado", () => {
    expect(paymentMethod("SUPER_NEW_WALLET")).toMatchObject({ key: "raw:super_new_wallet", label: "Super New Wallet" });
    expect(paymentMethod(null).label).toBe("Não informado");
    expect(prettifyMethod("PAYPAL_INTERNACIONAL")).toBe("Paypal Internacional");
  });

  it("a chave classificada volta para o mesmo meio (logo e cor)", () => {
    for (const raw of ["pix", "CASHPAYMENT", "debit_card", "FINANCED_BILLET", "SUPER_NEW_WALLET", ""]) {
      const info = paymentMethod(raw);
      expect(paymentByKey(info.key)).toEqual(info);
    }
  });
});
