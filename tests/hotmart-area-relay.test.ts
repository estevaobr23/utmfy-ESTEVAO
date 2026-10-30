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
  it("order bump de produto da lista libera o acesso do produto dele", () => {
    const r = buildAreaRelay({ event: "PURCHASE_APPROVED", data: { product: { id: 8844938, name: "50 Fallas de Secadoras" }, buyer: { email: "a@b.com" }, purchase: { transaction: "HP9", price: { value: 5 }, offer: { code: "dtj4rghv" }, order_bump: { is_order_bump: true, parent_purchase_transaction: "HP123" } } } }, ["8814892", "8844938"]);
    expect(r?.data).toMatchObject({ id: "HP9", product: { id: "8844938" }, offer: { short_id: "dtj4rghv" } });
  });
  it("reembolso e chargeback revogam", () => {
    expect(buildAreaRelay(base("PURCHASE_REFUNDED"), ["8814892"])?.event).toBe("refund");
    expect(buildAreaRelay(base("PURCHASE_CHARGEBACK"), ["8814892"])?.event).toBe("chargeback");
  });
  it("ignora outros eventos, outros produtos e compra sem e-mail", () => {
    expect(buildAreaRelay(base("PURCHASE_COMPLETE"), ["8814892"])).toBeNull();
    expect(buildAreaRelay(base("PURCHASE_APPROVED"), ["999"])).toBeNull();
    expect(buildAreaRelay({ event: "PURCHASE_APPROVED", data: { product: { id: 8814892 }, buyer: {}, purchase: { transaction: "X" } } }, ["8814892"])).toBeNull();
  });
});
