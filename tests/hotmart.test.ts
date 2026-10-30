import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/core/hash";
import { HOTMART_EVENTS, hotmartDate, hotmartOfferCode, hotmartProductId, normalizeHotmartOrder, normalizeHotmartPhone, parseHotmartEnvelope, redactHotmartPayload } from "@/lib/core/hotmart/normalize";
import { verifyHottok } from "@/lib/core/hotmart/signature";
import { purchaseEventId } from "@/lib/core/capi";

const TOKEN = "hottok-teste-123";
const T0 = 1_793_046_000_000;

function webhook(event: string, dataOver: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    creation_date: T0,
    event,
    version: "2.0.0",
    hottok: TOKEN,
    data: {
      product: { id: 8813153, ucode: "02cfd4f1", name: "120 Fallas de Lavadoras" },
      affiliates: [{ affiliate_code: "AFF1", name: "Fulano" }],
      buyer: {
        email: "Ana@Example.com ",
        name: "Ana López Pérez",
        address: { country: "México", country_iso: "MX", city: "CDMX" },
        checkout_phone: "55 1234 5678",
        checkout_phone_code: "52",
        document: "XAXX010101000",
      },
      producer: { name: "Produtor", document: "123" },
      commissions: [
        { value: 170.5, source: "PRODUCER", currency_value: "MXN" },
        { value: 26.5, source: "MARKETPLACE", currency_value: "MXN" },
      ],
      purchase: {
        approved_date: T0 - 60_000,
        order_date: T0 - 120_000,
        price: { value: 197, currency_value: "MXN" },
        status: "APPROVED",
        transaction: "HP19345427591111",
        payment: { type: "CREDIT_CARD", installments_number: 1, pix_code: "000201" },
        offer: { code: "trgj3by4" },
        origin: { sck: "sess_abc12345", src: "x" },
        order_bump: { is_order_bump: false },
      },
      ...dataOver,
    },
    ...over,
  };
}

describe("hottok", () => {
  it("aceita pelo cabeçalho", () => {
    expect(verifyHottok({ headerToken: TOKEN, bodyToken: null, secrets: [TOKEN] })).toEqual({ ok: true, method: "hottok_header" });
  });
  it("aceita pelo corpo quando o cabeçalho não vem", () => {
    expect(verifyHottok({ headerToken: null, bodyToken: TOKEN, secrets: ["outro", TOKEN] })).toEqual({ ok: true, method: "hottok_body" });
  });
  it("recusa token errado, ausente e sem configuração", () => {
    expect(verifyHottok({ headerToken: "errado", bodyToken: null, secrets: [TOKEN] })).toEqual({ ok: false, reason: "hottok_mismatch" });
    expect(verifyHottok({ headerToken: null, bodyToken: null, secrets: [TOKEN] })).toEqual({ ok: false, reason: "missing_hottok" });
    expect(verifyHottok({ headerToken: TOKEN, bodyToken: null, secrets: [] })).toEqual({ ok: false, reason: "no_secret_configured" });
  });
  it("cabeçalho errado mas corpo certo ainda vale (a Hotmart manda os dois)", () => {
    expect(verifyHottok({ headerToken: "errado", bodyToken: TOKEN, secrets: [TOKEN] }).ok).toBe(true);
  });
});

describe("envelope", () => {
  it("classifica os eventos", () => {
    expect(parseHotmartEnvelope(webhook("PURCHASE_APPROVED")).kind).toBe("order");
    expect(parseHotmartEnvelope(webhook("PURCHASE_REFUNDED")).kind).toBe("order");
    expect(parseHotmartEnvelope(webhook("PURCHASE_OUT_OF_SHOPPING_CART")).kind).toBe("abandonment");
    expect(parseHotmartEnvelope(webhook("CLUB_FIRST_ACCESS")).kind).toBe("ignored");
    expect(parseHotmartEnvelope(webhook("SWITCH_PLAN")).kind).toBe("ignored");
  });
  it("corpo inválido", () => {
    expect(parseHotmartEnvelope("x").kind).toBe("invalid");
    expect(parseHotmartEnvelope({ event: "PURCHASE_APPROVED" }).kind).toBe("invalid");
    expect(parseHotmartEnvelope({ data: {} }).kind).toBe("invalid");
  });
  it("lê o evento, o hottok e a data (epoch ms)", () => {
    const e = parseHotmartEnvelope(webhook("PURCHASE_APPROVED"));
    expect(e).toMatchObject({ event: "PURCHASE_APPROVED", hottok: TOKEN, eventId: "evt-1", eventAt: new Date(T0).toISOString() });
  });
  it("produto e código da oferta para decidir a oferta antes de gravar", () => {
    const e = parseHotmartEnvelope(webhook("PURCHASE_APPROVED"));
    expect(hotmartProductId(e.data)).toBe("8813153");
    expect(hotmartOfferCode(e.data)).toBe("trgj3by4");
    expect(hotmartProductId(null)).toBeNull();
  });
});

describe("normalização", () => {
  const norm = (event: string, over: Record<string, unknown> = {}) => {
    const e = parseHotmartEnvelope(webhook(event, over));
    return normalizeHotmartOrder(e.data!, { eventName: e.event, eventAt: e.eventAt });
  };

  it("compra em moeda local com repasse em USD vira pedido em USD (o que o produtor recebe)", () => {
    const r = norm("PURCHASE_APPROVED", {
      commissions: [
        { value: 0.99, source: "MARKETPLACE", currency_value: "USD" },
        { value: 8.01, source: "PRODUCER", currency_value: "USD", currency_conversion: { conversion_rate: 5.38, converted_value: 43.11, converted_to_currency: "BRL" } },
      ],
      purchase: { ...webhook("X").data.purchase, price: { value: 382, currency_value: "UYU" }, original_offer_price: { value: 9.5, currency_value: "USD" } },
    });
    expect("order" in r && r.order).toMatchObject({ currency: "USD", gross_amount: 9, fees: 0.99, net_amount: 8.01, base_amount: 9.5 });
  });

  it("venda aprovada em MXN", () => {
    const r = norm("PURCHASE_APPROVED");
    expect("order" in r && r.order).toMatchObject({
      provider: "hotmart",
      external_order_id: "HP19345427591111",
      status: "paid",
      raw_status: "APPROVED",
      currency: "MXN",
      gross_amount: 197,
      fees: 26.5,
      net_amount: 170.5,
      product_external_id: "8813153",
      offer_external_id: "trgj3by4",
      offer_type: "main",
      payment_method: "CREDIT_CARD",
      installments: 1,
      callback: "sess_abc12345",
    });
    if ("order" in r) {
      expect(r.order.paid_at).toBe(new Date(T0 - 60_000).toISOString());
      expect(r.order.provider_created_at).toBe(new Date(T0 - 120_000).toISOString());
      expect(r.order.attribution.sck).toBe("sess_abc12345");
    }
  });

  it("e-mail e telefone só como hash; telefone mexicano ganha DDI 52 (não 55)", () => {
    const r = norm("PURCHASE_APPROVED");
    if (!("order" in r)) throw new Error("falhou");
    expect(r.order.customer_email_sha256).toBe(sha256Hex("ana@example.com"));
    expect(r.order.customer_phone_sha256).toBe(sha256Hex("525512345678"));
    expect(JSON.stringify(r.order)).not.toContain("example.com");
  });

  it("evento → status", () => {
    const status = (ev: string) => {
      const r = norm(ev);
      return "order" in r ? r.order.status : r.error;
    };
    expect(status("PURCHASE_COMPLETE")).toBe("paid");
    expect(status("PURCHASE_BILLET_PRINTED")).toBe("pending");
    expect(status("PURCHASE_DELAYED")).toBe("pending");
    expect(status("PURCHASE_CANCELED")).toBe("canceled");
    expect(status("PURCHASE_EXPIRED")).toBe("canceled");
    expect(status("PURCHASE_REFUNDED")).toBe("refunded");
    expect(status("PURCHASE_CHARGEBACK")).toBe("chargedback");
    expect(status("PURCHASE_PROTEST")).toBe("disputed");
    expect(status("CLUB_FIRST_ACCESS")).toBe("unknown_event:CLUB_FIRST_ACCESS");
    expect(Object.keys(HOTMART_EVENTS)).toHaveLength(9);
  });

  it("reembolso/chargeback usam o momento do evento", () => {
    const r = norm("PURCHASE_REFUNDED");
    if (!("order" in r)) throw new Error("falhou");
    expect(r.order.refunded_at).toBe(new Date(T0).toISOString());
    expect(r.order.paid_at).toBeNull();
  });

  it("order bump: tipo e pedido-pai", () => {
    const r = norm("PURCHASE_APPROVED", { purchase: { ...(webhook("x").data.purchase as object), order_bump: { is_order_bump: true, parent_purchase_transaction: "HP0000" } } });
    expect("order" in r && r.order).toMatchObject({ offer_type: "orderbump", parent_order: "HP0000" });
  });

  it("sem comissão do produtor: usa a taxa da Hotmart se vier na mesma moeda", () => {
    const r = norm("PURCHASE_APPROVED", {
      commissions: [],
      purchase: { ...(webhook("x").data.purchase as object), hotmart_fee: { total: 20, currency_code: "MXN" } },
    });
    expect("order" in r && r.order).toMatchObject({ fees: 20, net_amount: 177 });
  });

  it("comissão em outra moeda não é misturada com o preço: o pedido passa para a moeda do repasse", () => {
    const r = norm("PURCHASE_APPROVED", { commissions: [{ value: 9, source: "PRODUCER", currency_value: "USD" }] });
    expect("order" in r && r.order).toMatchObject({ currency: "USD", gross_amount: 9, fees: 0, net_amount: 9 });
  });

  it("sck que não parece sessão não vira callback, mas continua em attribution.sck", () => {
    const r = norm("PURCHASE_APPROVED", { purchase: { ...(webhook("x").data.purchase as object), origin: { sck: "ab" } } });
    if (!("order" in r)) throw new Error("falhou");
    expect(r.order.callback).toBeNull();
    expect(r.order.attribution.sck).toBe("ab");
  });

  it("sem transação não grava", () => {
    const r = norm("PURCHASE_APPROVED", { purchase: { price: { value: 1, currency_value: "MXN" } } });
    expect(r).toEqual({ error: "missing_order_id" });
  });

  it("moeda ausente cai em BRL", () => {
    const r = norm("PURCHASE_APPROVED", { purchase: { transaction: "HP1", price: { value: 10 } } });
    expect("order" in r && r.order.currency).toBe("BRL");
  });
});

describe("utilitários", () => {
  it("datas em ms, segundos, ISO e lixo", () => {
    expect(hotmartDate(T0)).toBe(new Date(T0).toISOString());
    expect(hotmartDate(String(T0))).toBe(new Date(T0).toISOString());
    expect(hotmartDate(Math.floor(T0 / 1000))).toBe(new Date(T0).toISOString());
    expect(hotmartDate("2026-10-26T18:00:00Z")).toBe("2026-10-26T18:00:00.000Z");
    expect(hotmartDate("")).toBeNull();
    expect(hotmartDate("abc")).toBeNull();
  });
  it("telefone com e sem DDI", () => {
    expect(normalizeHotmartPhone("5512345678", "52")).toBe("525512345678");
    expect(normalizeHotmartPhone("525512345678", "52")).toBe("525512345678");
    expect(normalizeHotmartPhone("123", "52")).toBeNull();
    expect(normalizeHotmartPhone("5512345678")).toBe("5512345678");
  });
  it("event_id da Meta separa provedores (um pedido Cakto e um Hotmart nunca colidem)", () => {
    expect(purchaseEventId("hotmart", "HP1")).toBe("hotmart:HP1:Purchase");
    expect(purchaseEventId("hotmart", "HP1")).not.toBe(purchaseEventId("cakto", "HP1"));
  });
});

describe("payload de auditoria", () => {
  it("tira hottok, PII e dados de pagamento", () => {
    const red = redactHotmartPayload(webhook("PURCHASE_APPROVED")) as Record<string, unknown>;
    const txt = JSON.stringify(red);
    expect(txt).not.toContain(TOKEN);
    expect(txt).not.toContain("example.com");
    expect(txt).not.toContain("Ana");
    expect(txt).not.toContain("XAXX010101000");
    expect(txt).not.toContain("000201");
    expect(txt).toContain("AFF1");
    const data = red.data as { buyer: unknown; purchase: { transaction: string } };
    expect(data.buyer).toMatchObject({ email_sha256: sha256Hex("ana@example.com"), country: "MX" });
    expect(data.purchase.transaction).toBe("HP19345427591111");
  });
});
