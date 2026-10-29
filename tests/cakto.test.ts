import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { caktoOrder, caktoWebhook } from "@/lib/core/cakto/fixtures";
import { isUnchangedOrder, normalizeCaktoOrder, normalizePhone, pickMappedOffer, normalizeStatus, offerIdFromCheckoutUrl, parseEnvelope, redactPayload } from "@/lib/core/cakto/normalize";
import { parseSignatureHeader, verifyCaktoWebhook } from "@/lib/core/cakto/signature";
import { sha256Hex } from "@/lib/core/hash";
import { toMoney } from "@/lib/core/money";

const SECRET = "whsec-test-123";
const sign = (ts: number, body: string, secret = SECRET) => `v1=${createHmac("sha256", secret).update(`${ts}.`).update(body).digest("hex")}`;

describe("assinatura do webhook", () => {
  const body = JSON.stringify(caktoWebhook("purchase_approved", caktoOrder(), SECRET));
  const now = 1_790_000_000;
  const base = { rawBody: body, bodySecret: SECRET, secrets: [SECRET], nowSeconds: now };

  it("válida (HMAC do timestamp + corpo cru)", () => {
    expect(verifyCaktoWebhook({ ...base, timestampHeader: String(now), signatureHeader: sign(now, body) })).toEqual({ ok: true, method: "header_hmac", timestamp: now });
  });
  it("assinatura inválida", () => {
    expect(verifyCaktoWebhook({ ...base, timestampHeader: String(now), signatureHeader: sign(now, body, "outro") })).toEqual({ ok: false, reason: "signature_mismatch" });
  });
  it("corpo adulterado (reserializado) invalida", () => {
    const tampered = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyCaktoWebhook({ ...base, rawBody: tampered, timestampHeader: String(now), signatureHeader: sign(now, body) }).ok).toBe(false);
  });
  it("replay: timestamp fora da tolerância de 5 min", () => {
    const old = now - 301;
    expect(verifyCaktoWebhook({ ...base, timestampHeader: String(old), signatureHeader: sign(old, body) })).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });
  it("aceita múltiplas versões no header e múltiplos secrets", () => {
    const header = `v2=abc, ${sign(now, body)}`;
    expect(parseSignatureHeader(header)).toHaveLength(1);
    expect(verifyCaktoWebhook({ ...base, secrets: ["s1", SECRET], timestampHeader: String(now), signatureHeader: header }).ok).toBe(true);
  });
  it("sem headers: body secret só se permitido", () => {
    expect(verifyCaktoWebhook({ ...base, timestampHeader: null, signatureHeader: null, allowBodySecret: false })).toEqual({ ok: false, reason: "body_secret_not_allowed" });
    expect(verifyCaktoWebhook({ ...base, timestampHeader: null, signatureHeader: null, allowBodySecret: true })).toMatchObject({ ok: true, method: "body_secret" });
    expect(verifyCaktoWebhook({ ...base, bodySecret: "errado", timestampHeader: null, signatureHeader: null, allowBodySecret: true })).toEqual({ ok: false, reason: "body_secret_mismatch" });
  });
  it("sem secret configurado recusa", () => {
    expect(verifyCaktoWebhook({ ...base, secrets: [], timestampHeader: String(now), signatureHeader: sign(now, body) })).toEqual({ ok: false, reason: "no_secret_configured" });
  });
});

describe("envelope e normalização", () => {
  it("data como objeto", () => {
    const e = parseEnvelope(caktoWebhook("purchase_approved", caktoOrder()));
    expect(e).toMatchObject({ kind: "order", event: "purchase_approved" });
    expect(e.items).toHaveLength(1);
  });
  it("data como array (Webhook V2: principal + order bump + upsell)", () => {
    const e = parseEnvelope(
      caktoWebhook("purchase_approved", [caktoOrder({ id: "main-1" }), caktoOrder({ id: "bump-1", offer_type: "orderbump", parent_order: "4852F91", amount: 9.9 }), caktoOrder({ id: "up-1", offer_type: "upsell" })]),
    );
    expect(e.items.map((i) => i.id)).toEqual(["main-1", "bump-1", "up-1"]);
    const bump = normalizeCaktoOrder(e.items[1], { eventName: e.event });
    expect("order" in bump && bump.order).toMatchObject({ offer_type: "orderbump", parent_order: "4852F91", gross_amount: 9.9 });
  });
  it("checkout_abandonment é separado (sem id)", () => {
    expect(parseEnvelope({ event: "checkout_abandonment", data: { offer: {}, customerEmail: "x@y.com" } }).kind).toBe("abandonment");
  });
  it("payload inválido", () => {
    expect(parseEnvelope("x").kind).toBe("invalid");
    expect(parseEnvelope({ event: "purchase_approved", data: null }).kind).toBe("invalid");
  });

  it("purchase approved", () => {
    const n = normalizeCaktoOrder(caktoOrder(), { eventName: "purchase_approved", eventAt: "2026-09-30T13:02:05.000Z" });
    if (!("order" in n)) throw new Error("falhou");
    expect(n.order).toMatchObject({
      external_order_id: "b3df956e-1998-4322-b091-ac0c54f7b4ba",
      ref_id: "4852F91",
      status: "paid",
      gross_amount: 32.9,
      fees: 2.62,
      discount: 0,
      net_amount: 30.28,
      offer_external_id: "a8BcHrY",
      product_external_id: "cd287b31-d4b7-4e94-858a-96e05ce2f4a2",
      paid_at: "2026-09-30T13:02:00.000Z",
      event_at: "2026-09-30T13:02:05.000Z",
      currency: "BRL",
    });
    expect(n.order.attribution.utm_content).toBe("Ad 123|120200000000000123");
    expect(n.order.customer_email_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("Pix gerado = pending", () => {
    const n = normalizeCaktoOrder(caktoOrder({ status: "waiting_payment", paidAt: null }), { eventName: "pix_gerado" });
    expect("order" in n && n.order.status).toBe("pending");
  });
  it("reembolso, pedido de reembolso e chargeback", () => {
    const r = normalizeCaktoOrder(caktoOrder({ status: "refunded", refundedAt: "2026-10-01T10:00:00-03:00" }), { eventName: "refund" });
    expect("order" in r && r.order).toMatchObject({ status: "refunded", refunded_at: "2026-10-01T13:00:00.000Z", event_at: "2026-10-01T13:00:00.000Z" });
    const rr = normalizeCaktoOrder(caktoOrder({ status: "refund_requested", refundRequest: { requestedAt: "2026-10-01T09:00:00-03:00" } }), { eventName: "refund_requested" });
    expect("order" in rr && rr.order.status).toBe("refund_requested");
    const cb = normalizeCaktoOrder(caktoOrder({ status: "chargedback", chargedbackAt: "2026-10-05T10:00:00-03:00" }), { eventName: "chargeback" });
    expect("order" in cb && cb.order.status).toBe("chargedback");
  });
  it("status desconhecido cai no evento; sem id dá erro", () => {
    expect(normalizeStatus("status_novo", "purchase_approved")).toBe("paid");
    expect(normalizeStatus("MED")).toBe("disputed");
    expect(normalizeCaktoOrder({ status: "paid" })).toEqual({ error: "missing_order_id" });
  });
  it("formato da API (valores como string, sem objeto offer)", () => {
    const n = normalizeCaktoOrder({ ...caktoOrder(), offer: undefined, amount: "34.35", baseAmount: "33.00", fees: "1.52", commissions: undefined, checkoutUrl: "https://pay.cakto.com.br/EXAMPLE?x=1" });
    expect("order" in n && n.order).toMatchObject({ gross_amount: 34.35, base_amount: 33, fees: 1.52, offer_external_id: "EXAMPLE" });
  });
  it("dinheiro em tipos mistos não concatena", () => {
    expect(toMoney(5.0)).toBe(5);
    expect(toMoney("0.00")).toBe(0);
    expect(toMoney("1.234,56")).toBe(1234.56);
    expect(toMoney("1,234.56")).toBe(1234.56);
    expect(toMoney(null)).toBeNull();
  });
  it("helpers", () => {
    expect(normalizePhone("(34) 99999-9999")).toBe("5534999999999");
    expect(normalizePhone("5534999999999")).toBe("5534999999999");
    expect(offerIdFromCheckoutUrl("https://pay.cakto.com.br/32f9yzc?callback=1")).toBe("32f9yzc");
  });
  it("redação: tira secret e PII do payload guardado", () => {
    const red = redactPayload(caktoWebhook("purchase_approved", caktoOrder(), "segredo")) as { data: Record<string, unknown> } & Record<string, unknown>;
    const s = JSON.stringify(red);
    expect(red.secret).toBeUndefined();
    expect(s).not.toContain("segredo");
    expect(s).not.toContain("cliente.teste@example.com");
    expect(s).not.toContain("12345678909");
    expect(s).not.toContain("000201");
    expect((red.data.customer as Record<string, unknown>).email_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("nome do comprador só como hash (CAPI)", () => {
  it("primeiro e último nome com hash; o nome em claro não aparece no pedido normalizado", () => {
    const r = normalizeCaktoOrder(caktoOrder({ customer: { id: 1, name: "Maria da Silva", email: "m@x.com", phone: "34999999999" } }) as Record<string, unknown>, {});
    if (!("order" in r)) throw new Error("esperava pedido");
    expect(r.order.customer_fn_sha256).toBe(sha256Hex("maria"));
    expect(r.order.customer_ln_sha256).toBe(sha256Hex("silva"));
    expect(JSON.stringify(r.order)).not.toMatch(/maria/i);
  });
  it("sem nome, sem hash", () => {
    const r = normalizeCaktoOrder(caktoOrder({ customer: { id: 1, email: "m@x.com" } }) as Record<string, unknown>, {});
    if (!("order" in r)) throw new Error("esperava pedido");
    expect(r.order.customer_fn_sha256).toBeNull();
    expect(r.order.customer_ln_sha256).toBeNull();
  });
});

describe("líquido pela comissão do produtor", () => {
  it("venda internacional (USD): comissão do produtor vem em totalAmount", () => {
    const n = normalizeCaktoOrder({ id: "ord-usd", status: "paid", amount: 12.99, baseAmount: 12, fees: 1.54, currency: "USD", paidAt: "2026-10-29T11:12:50Z", commissions: [{ type: "producer", percentage: 100, totalAmount: 10.46 }] }, {});
    if ("error" in n) throw new Error(n.error);
    expect(n.order.gross_amount).toBe(12.99);
    expect(n.order.fees).toBe(2.53);
    expect(n.order.net_amount).toBe(10.46);
  });
  it("taxa de serviço paga pelo comprador (R$ 0,99) sai do líquido, como na UTMify", () => {
    const n = normalizeCaktoOrder({ id: "ord-1", status: "paid", amount: "30.89", baseAmount: "29.90", fees: "3.98", paidAt: "2026-10-11T12:00:00Z", commissions: [{ type: "producer", commissionValue: 25.92 }] }, {});
    if ("error" in n) throw new Error(n.error);
    expect(n.order.gross_amount).toBe(30.89);
    expect(n.order.fees).toBe(4.97);
    expect(n.order.net_amount).toBe(25.92);
  });
  it("sem comissão no payload, usa o campo fees", () => {
    const n = normalizeCaktoOrder({ id: "ord-2", status: "paid", amount: "32.90", fees: "2.63", paidAt: "2026-10-11T12:00:00Z" }, {});
    if ("error" in n) throw new Error(n.error);
    expect(n.order.fees).toBe(2.63);
  });
});

describe("reconciliação sem reprocessar pedido igual", () => {
  const incoming = { status: "paid" as const, gross_amount: 47.9, net_amount: 43.5, fees: 4.4 };
  const row = { status: "paid", gross_amount: "47.90", net_amount: "43.50", fees: "4.40", offer_id: "O1" };

  it("igual no banco (valores numéricos em texto) e com oferta → não reprocessa", () => {
    expect(isUnchangedOrder(row, incoming, "O1")).toBe(true);
  });
  it("status ou valor mudou → reprocessa", () => {
    expect(isUnchangedOrder({ ...row, status: "pending" }, incoming, "O1")).toBe(false);
    expect(isUnchangedOrder({ ...row, fees: "5.00" }, incoming, "O1")).toBe(false);
  });
  it("sem oferta: só é igual se continua sem mapeamento; vínculo novo exige reprocessar", () => {
    expect(isUnchangedOrder({ ...row, offer_id: null }, incoming, null)).toBe(true);
    expect(isUnchangedOrder({ ...row, offer_id: null }, incoming, "O1")).toBe(false);
  });
  it("pickMappedOffer: oferta exata > mesma oferta Cakto > produto", () => {
    const items = [
      { offer_id: "A", cakto_product_id: "P1", cakto_offer_id: null },
      { offer_id: "B", cakto_product_id: "P1", cakto_offer_id: "X9" },
    ];
    expect(pickMappedOffer(items, "P1", "X9")).toBe("B");
    expect(pickMappedOffer(items, "P1", "OUTRA")).toBe("A");
    expect(pickMappedOffer(items, "P2", null)).toBeNull();
  });
});
