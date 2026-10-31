import { describe, expect, it } from "vitest";
import { hotmartApiSaleToData } from "@/lib/core/hotmart/api-order";
import { normalizeHotmartOrder } from "@/lib/core/hotmart/normalize";

const mxn = {
  product: { id: 8814892, name: "120 Fallas de Lavadoras" },
  buyer: { name: "Fulana de Tal", email: "Fulana@Exemplo.com" },
  purchase: {
    transaction: "HP1450060819", status: "APPROVED", order_date: 1793404890000, approved_date: 1793404893000,
    offer: { code: "l7x4p2n4" }, price: { currency_code: "MXN", value: 207.64 }, payment: { type: "CREDIT_CARD", installments_number: 1 },
    hotmart_fee: { fixed: 0.1, percentage: 9.9, total: 0.99, base: 179 }, tracking: { source_sck: "s0bpnulibzij9fw327dq9" },
  },
};
const comm = { transaction: "HP1450060819", commissions: [{ source: "PRODUCER", commission: { currency_code: "USD", value: 8.04 } }] };

describe("Hotmart API de vendas → pedido", () => {
  it("compra em MXN vira pedido em USD com bruto = comissão + taxa (igual ao webhook)", () => {
    const { data, event } = hotmartApiSaleToData(mxn, comm);
    expect(event).toBe("PURCHASE_APPROVED");
    const r = normalizeHotmartOrder(data, { eventName: event, mainProductIds: ["8814892"] });
    if (!("order" in r)) throw new Error(r.error);
    expect(r.order).toMatchObject({ currency: "USD", gross_amount: 9.03, fees: 0.99, net_amount: 8.04, offer_type: "main", callback: "s0bpnulibzij9fw327dq9", offer_external_id: "l7x4p2n4" });
  });
  it("compra em USD e produto fora da lista principal vira complemento", () => {
    const sale = { ...mxn, product: { id: 8844938, name: "50 Fallas de Secadoras" }, purchase: { ...mxn.purchase, transaction: "HP1640203396", price: { currency_code: "USD", value: 5 }, hotmart_fee: { total: 0.6 } } };
    const { data, event } = hotmartApiSaleToData(sale, { transaction: "HP1640203396", commissions: [{ source: "PRODUCER", commission: { currency_code: "USD", value: 4.4 } }] });
    const r = normalizeHotmartOrder(data, { eventName: event, mainProductIds: ["8814892"] });
    if (!("order" in r)) throw new Error(r.error);
    expect(r.order).toMatchObject({ currency: "USD", gross_amount: 5, fees: 0.6, net_amount: 4.4, offer_type: "orderbump" });
  });
  it("sem comissão não inventa valor em dólar; status da API vira o evento do webhook", () => {
    const { data, event } = hotmartApiSaleToData({ ...mxn, purchase: { ...mxn.purchase, status: "REFUNDED" } }, null);
    expect(event).toBe("PURCHASE_REFUNDED");
    expect((data.commissions as unknown[]).length).toBe(0);
    expect(hotmartApiSaleToData({ ...mxn, purchase: { ...mxn.purchase, status: "WAITING_PAYMENT" } }, null).event).toBeNull();
  });
});
