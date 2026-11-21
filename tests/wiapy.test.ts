import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/core/hash";
import {
  fbclidFromFbc, isWiapyTestBuyer, normalizeWiapyOrders, parseWiapyEnvelope, redactWiapyPayload, splitTermSession, wiapyMoney, wiapyProductIds, wiapyTracking,
} from "@/lib/core/wiapy/normalize";
import { verifyWiapyAuth, wiapyOwnerId } from "@/lib/core/wiapy/signature";
import { matchWindow, pickSession } from "@/lib/core/wiapy/session-match";

// Payload no formato da doc da Wiapy (help.wiapy.com/pt-br/article/webhook-jtggmu, 13/11/2026): valores em centavos.
const SID = "s0abc123def456ghi789j";
function paid(over: Record<string, unknown> = {}, payOver: Record<string, unknown> = {}) {
  return {
    payment: {
      id: "6b01aa11ba649e6c36a70001", status: "paid", amount: 2990, payment_method: "pix", type: "payment", installments: 1,
      installment_interest_rate: 0, credit_card_interest_fee: 0, pix_boleto: { code: "00020126...", url: "https://pix" }, fee: 200,
      coupon: null, coupon_discount: 0, payment_method_discount: 0, orderbump_all_discount: 0,
      dt_create: "2026-11-20T15:00:00.000Z", dt_update: "2026-11-20T15:02:10.284Z", ...payOver,
    },
    subscription: {},
    customer: { id: "c1", name: "Maria da Silva Souza", email: " Maria@Example.com ", mobile_phone: "(11) 98888-7777", document: "12345678900" },
    checkout: { id: "6b00e1c2ba649e6c36a6eeb3", title: "Material Digital de Projetos · Acesso Completo", amount: 2990, orderbump: [] },
    products: [{ id: "6b00e1bbba649e6c36a6edec", title: "Material Digital", type: "E-book", itens: [{ title: "PDF", url: "https://x" }] }],
    tracking: {
      ip: "189.10.20.30", useragent: "Mozilla/5.0 (iPhone) Instagram 300", fbc: "fb.1.1763650000000.IwAR0abcDEF", fbp: "fb.1.1763650000000.123456",
      utm_source: "FB", utm_medium: "Conjunto|120200000000000002", utm_campaign: "Campanha|120200000000000001", utm_content: "AD 1|120200000000000123",
      utm_term: `Instagram_Reels|sid_${SID}`,
    },
    ...over,
  };
}
const abandoned = {
  payment: null, subscription: null,
  customer: { id: null, name: "João", email: "joao@example.com", mobile_phone: "11999990000", document: null },
  checkout: { id: "6b00e1c2ba649e6c36a6eeb3", title: "Material Digital", amount: 2990, orderbump: null },
  products: null, tracking: null,
};

describe("Wiapy: envelope e valores", () => {
  it("centavos → reais (e número com casas já em reais, formato antigo)", () => {
    expect(wiapyMoney(1770)).toBe(17.7);
    expect(wiapyMoney("2990")).toBe(29.9);
    expect(wiapyMoney(29.9)).toBe(29.9);
    expect(wiapyMoney(null)).toBeNull();
    expect(wiapyMoney("x")).toBeNull();
  });

  it("status do pagamento define o evento (a Wiapy não manda nome de evento)", () => {
    const m = (status: string) => parseWiapyEnvelope(paid({}, { status }));
    expect(m("paid")).toMatchObject({ kind: "order", status: "paid", event: "payment_paid", paymentId: "6b01aa11ba649e6c36a70001" });
    expect(m("unpaid").status).toBe("pending");
    expect(m("credit_card_declined").status).toBe("refused");
    expect(m("refunded").status).toBe("refunded");
    expect(m("chargedback").status).toBe("chargedback");
    expect(m("algo_novo").kind).toBe("invalid");
    expect(parseWiapyEnvelope(abandoned)).toMatchObject({ kind: "abandonment", event: "cart_abandoned" });
    expect(parseWiapyEnvelope("x").kind).toBe("invalid");
  });

  it("comprador fictício do teste da Wiapy é marcado como teste", () => {
    expect(isWiapyTestBuyer("teste+wiapy@wiapy.com")).toBe(true);
    expect(isWiapyTestBuyer("TESTE+WIAPY@WIAPY.COM ")).toBe(true);
    expect(isWiapyTestBuyer("maria@example.com")).toBe(false);
    expect(parseWiapyEnvelope(paid({ customer: { email: "teste+wiapy@wiapy.com" } })).isTest).toBe(true);
  });

  it("ids que ligam a venda à oferta: produto (checkout.id), bumps e entregáveis", () => {
    expect(wiapyProductIds(paid())).toEqual({ checkoutId: "6b00e1c2ba649e6c36a6eeb3", bumpIds: [], deliverableIds: ["6b00e1bbba649e6c36a6edec"] });
  });
});

describe("Wiapy: sessão no utm_term e tracking", () => {
  it("separa posicionamento e sessão", () => {
    expect(splitTermSession(`Instagram_Reels|sid_${SID}`)).toEqual({ term: "Instagram_Reels", sessionId: SID });
    expect(splitTermSession(`sid_${SID}`)).toEqual({ term: null, sessionId: SID });
    expect(splitTermSession(`Instagram_Reels%7Csid_${SID}`)).toEqual({ term: "Instagram_Reels", sessionId: SID });
    expect(splitTermSession("Facebook_Mobile_Feed")).toEqual({ term: "Facebook_Mobile_Feed", sessionId: null });
    expect(splitTermSession(null)).toEqual({ term: null, sessionId: null });
  });
  it("fbclid do fbc", () => {
    expect(fbclidFromFbc("fb.1.1763650000000.IwAR0abcDEF")).toBe("IwAR0abcDEF");
    expect(fbclidFromFbc("fb.1.17.Iw.AR.0abc")).toBe("Iw.AR.0abc");
    expect(fbclidFromFbc("lixo")).toBeNull();
  });
  it("tracking: UTMs limpas + IP/navegador/fbc/fbp", () => {
    const t = wiapyTracking(paid());
    expect(t.utms.utm_term).toBe("Instagram_Reels");
    expect(t.termSessionId).toBe(SID);
    expect(t.ip).toBe("189.10.20.30");
    expect(t.userAgent).toContain("Instagram");
    expect(wiapyTracking(abandoned)).toMatchObject({ ip: null, termSessionId: null });
  });
});

describe("Wiapy: pedido normalizado", () => {
  it("venda PIX paga: reais, taxa, líquido, hashes, UTMs, sessão e datas", () => {
    const r = normalizeWiapyOrders(paid(), { callback: SID });
    if ("error" in r) throw new Error(r.error);
    expect(r.orders).toHaveLength(1);
    const o = r.orders[0];
    expect(o).toMatchObject({
      provider: "wiapy", external_order_id: "6b01aa11ba649e6c36a70001", status: "paid", raw_status: "paid", offer_type: "main",
      product_external_id: "6b00e1c2ba649e6c36a6eeb3", currency: "BRL", gross_amount: 29.9, fees: 2, net_amount: 27.9, payment_method: "pix",
      callback: SID, paid_at: "2026-11-20T15:02:10.284Z", provider_created_at: "2026-11-20T15:00:00.000Z",
    });
    expect(o.customer_email_sha256).toBe(sha256Hex("maria@example.com"));
    expect(o.customer_phone_sha256).toBe(sha256Hex("5511988887777"));
    expect(o.customer_fn_sha256).toBe(sha256Hex("maria"));
    expect(o.customer_ln_sha256).toBe(sha256Hex("souza"));
    expect(o.attribution).toMatchObject({ utm_source: "FB", utm_term: "Instagram_Reels", utm_content: "AD 1|120200000000000123", sck: SID, fbc: "fb.1.1763650000000.IwAR0abcDEF" });
  });

  it("pendente, recusado, estorno e chargeback", () => {
    const get = (status: string) => { const r = normalizeWiapyOrders(paid({}, { status })); if ("error" in r) throw new Error(r.error); return r.orders[0]; };
    expect(get("unpaid")).toMatchObject({ status: "pending", paid_at: null });
    expect(get("credit_card_declined")).toMatchObject({ status: "refused", paid_at: null });
    expect(get("refunded")).toMatchObject({ status: "refunded", refunded_at: "2026-11-20T15:02:10.284Z" });
    expect(get("chargedback")).toMatchObject({ status: "chargedback", chargedback_at: "2026-11-20T15:02:10.284Z" });
  });

  it("order bump vira pedido próprio (orderbump) e o principal fica com o resto; taxa rateada", () => {
    const body = paid({ checkout: { id: "P1", title: "Principal", amount: 2990, orderbump: [{ id: "B1", title: "Bump", amount: 990 }] } }, { amount: 3980, fee: 398 });
    const r = normalizeWiapyOrders(body);
    if ("error" in r) throw new Error(r.error);
    expect(r.orders.map((o) => [o.external_order_id, o.offer_type, o.gross_amount, o.fees, o.parent_order, o.product_external_id])).toEqual([
      ["6b01aa11ba649e6c36a70001", "main", 29.9, 2.99, null, "P1"],
      ["6b01aa11ba649e6c36a70001:B1", "orderbump", 9.9, 0.99, "6b01aa11ba649e6c36a70001", "B1"],
    ]);
  });

  it("carrinho abandonado não vira pedido", () => {
    expect(normalizeWiapyOrders(abandoned)).toEqual({ error: "abandonment" });
  });

  it("auditoria sem PII (e-mail, telefone, documento, PIX, IP, navegador)", () => {
    const red = JSON.stringify(redactWiapyPayload(paid()));
    for (const s of ["Maria@Example.com", "98888", "12345678900", "00020126", "189.10.20.30", "iPhone", "IwAR0abcDEF"]) expect(red).not.toContain(s);
    expect(red).toContain(sha256Hex("maria@example.com"));
  });
});

describe("Wiapy: autenticação e casamento de sessão", () => {
  it("token no Authorization (cru ou Bearer), em tempo constante", () => {
    expect(verifyWiapyAuth({ header: "tok123", secrets: ["tok123"] })).toEqual({ ok: true, method: "authorization_header" });
    expect(verifyWiapyAuth({ header: "Bearer tok123", secrets: [null, "tok123"] }).ok).toBe(true);
    expect(verifyWiapyAuth({ header: "errado", secrets: ["tok123"] })).toEqual({ ok: false, reason: "token_mismatch" });
    expect(verifyWiapyAuth({ header: null, secrets: ["tok123"] })).toEqual({ ok: false, reason: "missing_token" });
    expect(verifyWiapyAuth({ header: "x", secrets: [null, ""] })).toEqual({ ok: false, reason: "no_secret_configured" });
  });

  it("dono do token no Vault: uuid estável derivado da oferta (≠ do segredo da Cakto)", () => {
    const id = "0b6f1f0e-1111-4222-8333-444455556666";
    expect(wiapyOwnerId(id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(wiapyOwnerId(id)).toBe(wiapyOwnerId(id));
    expect(wiapyOwnerId(id)).not.toBe(id);
  });

  it("escolhe a sessão da mesma oferta e mais perto do pagamento; 'único' exige 1 candidata", () => {
    const at = "2026-11-20T15:00:00.000Z";
    const c = [
      { session_id: "outra-oferta-1", offer_id: "B", last_seen_at: "2026-11-20T14:59:00.000Z" },
      { session_id: "longe-aaaaaa", offer_id: "A", last_seen_at: "2026-11-19T10:00:00.000Z" },
      { session_id: "perto-aaaaaa", offer_id: "A", last_seen_at: "2026-11-20T14:55:00.000Z" },
    ];
    expect(pickSession(c, { offerId: "A", at })).toBe("perto-aaaaaa");
    expect(pickSession(c, { offerId: "A", at, unique: true })).toBeNull();
    expect(pickSession([c[2]], { offerId: "A", at, unique: true })).toBe("perto-aaaaaa");
    expect(pickSession([c[0]], { offerId: "A", at })).toBe("outra-oferta-1");
    expect(pickSession([c[0]], { offerId: "A", at, unique: true })).toBeNull();
    const w = matchWindow(at);
    expect(w.from).toBe("2026-11-18T15:00:00.000Z");
    expect(w.to).toBe("2026-11-20T15:30:00.000Z");
  });
});
