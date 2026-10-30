import { describe, expect, it } from "vitest";
import { buildEntrega } from "../src/lib/core/hotmart/entrega";

const ev = (over: Record<string, unknown> = {}, buyer: Record<string, unknown> = {}) => ({
  event: "PURCHASE_APPROVED",
  data: {
    product: { id: 8845970 },
    buyer: { email: " Ana@Mail.com ", name: "Ana López", checkout_phone: "55 1234 5678", checkout_phone_code: "52", ...buyer },
    purchase: { transaction: "HP9", order_bump: { is_order_bump: true, parent_purchase_transaction: "HP1" }, ...over },
  },
});

describe("entrega por WhatsApp", () => {
  it("bump de entrega aprovado devolve pedido principal, e-mail e telefone com DDI", () => {
    expect(buildEntrega(ev(), "8845970")).toEqual({ transaction: "HP9", parent: "HP1", email: "ana@mail.com", name: "Ana López", phone: "525512345678" });
  });
  it("produto de entrega como oferta principal não tem parent", () => {
    expect(buildEntrega(ev({ order_bump: { is_order_bump: false } }), "8845970")?.parent).toBeNull();
  });
  it("ignora outro produto, outro evento e compra sem telefone", () => {
    expect(buildEntrega(ev(), "999")).toBeNull();
    expect(buildEntrega({ ...ev(), event: "PURCHASE_REFUNDED" }, "8845970")).toBeNull();
    expect(buildEntrega(ev({}, { checkout_phone: null, phone: null }), "8845970")).toBeNull();
  });
});
