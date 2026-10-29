import { describe, expect, it } from "vitest";
import { buildAreaRelay } from "../src/lib/core/hotmart/area-relay";

const base = (event: string, over: Record<string, unknown> = {}) => ({
  event,
  data: { product: { id: 8814892, name: "120 Fallas de Lavadoras" }, buyer: { email: " Ana@Mail.com ", name: "Ana", checkout_phone: "5512345678" },
    purchase: { transaction: "HP123", price: { value: 12 }, offer: { code: "pdoa28vd" }, ...over } },
});

describe("repasse Hotmart → área de membros", () => {
  it("venda aprovada vira purchase_approved no formato da função da área", () => {
    const r = buildAreaRelay(base("PURCHASE_APPROVED"), ["8814892"]);
    expect(r).toEqual({ event: "purchase_approved", data: expect.objectContaining({ id: "HP123", amount: 12, customer: { email: "ana@mail.com", name: "Ana", phone: "5512345678" }, product: { id: "8814892", name: "120 Fallas de Lavadoras" }, offer: { id: null, short_id: "pdoa28vd", name: null } }) });
  });
  it("reembolso e chargeback revogam", () => {
    expect(buildAreaRelay(base("PURCHASE_REFUNDED"), ["8814892"])?.event).toBe("refund");
    expect(buildAreaRelay(base("PURCHASE_CHARGEBACK"), ["8814892"])?.event).toBe("chargeback");
  });
  it("ignora outros eventos, outros produtos, order bump e compra sem e-mail", () => {
    expect(buildAreaRelay(base("PURCHASE_COMPLETE"), ["8814892"])).toBeNull();
    expect(buildAreaRelay(base("PURCHASE_APPROVED"), ["999"])).toBeNull();
    expect(buildAreaRelay(base("PURCHASE_APPROVED", { order_bump: { is_order_bump: true } }), ["8814892"])).toBeNull();
    expect(buildAreaRelay({ event: "PURCHASE_APPROVED", data: { product: { id: 8814892 }, buyer: {}, purchase: { transaction: "X" } } }, ["8814892"])).toBeNull();
  });
});
