// Normalização defensiva do webhook da Wiapy.
// Referência: https://help.wiapy.com/pt-br/article/webhook-jtggmu/ (lida em 20/11/2026)
//  * POST JSON, token no cabeçalho Authorization (cru; aceitamos também "Bearer <token>")
//  * NÃO há nome de evento no corpo: o status do pagamento define tudo; carrinho abandonado = payment/tracking/products null
//  * valores em CENTAVOS (R$ 17,70 = 1770). Defesa: número com casas decimais (29.9) é tratado como reais (formato antigo)
//  * products[] = conteúdos entregáveis (inclui os dos order bumps); checkout.id = o PRODUTO da Wiapy (o que vinculamos à oferta)
//  * a Wiapy NÃO devolve sck/callback: o t.js leva a sessão no utm_term (`<posicionamento>|sid_<sessão>`), que voltam em tracking
import { sha256Hex } from "../hash";
import { hashForMeta, splitName } from "../capi";
import { normalizeEmail, normalizePhone, type NormalizedOrder, type OrderStatus } from "../cakto/normalize";

export const WIAPY_STATUS = {
  paid: "paid",
  unpaid: "pending",
  credit_card_declined: "refused",
  refunded: "refunded",
  chargedback: "chargedback",
} as const satisfies Record<string, OrderStatus>;

/** Comprador fictício dos testes da Wiapy (integrations_test). Pedido dele = teste: fora das métricas e NUNCA vai à Meta. */
export const WIAPY_TEST_EMAIL = "teste+wiapy@wiapy.com";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const obj = (v: unknown): Record<string, unknown> => (isObject(v) ? v : {});
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined" ? null : s;
}
function iso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Centavos (inteiro) → reais. Número com casas decimais já está em reais (payload antigo). */
export function wiapyMoney(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const isInt = Number.isInteger(n) && !(typeof v === "string" && /[.,]/.test(v));
  return Math.round((isInt ? n / 100 : n) * 100) / 100;
}

export type WiapyEnvelope = {
  kind: "order" | "abandonment" | "invalid";
  /** Nome sintético (a Wiapy não manda): payment_<status> | cart_abandoned. */
  event: string | null;
  paymentId: string | null;
  rawStatus: string | null;
  status: OrderStatus | null;
  isTest: boolean;
};

export function isWiapyTestBuyer(email: unknown): boolean {
  const e = normalizeEmail(email);
  return !!e && (e === WIAPY_TEST_EMAIL || e.endsWith("@wiapy.com"));
}

export function parseWiapyEnvelope(body: unknown): WiapyEnvelope {
  const empty: WiapyEnvelope = { kind: "invalid", event: null, paymentId: null, rawStatus: null, status: null, isTest: false };
  if (!isObject(body)) return empty;
  const isTest = isWiapyTestBuyer(obj(body.customer).email);
  if (!isObject(body.payment)) {
    // Carrinho abandonado: checkout + customer sem pagamento.
    if (isObject(body.checkout) || isObject(body.customer)) return { ...empty, kind: "abandonment", event: "cart_abandoned", isTest };
    return { ...empty, isTest };
  }
  const payment = body.payment;
  const rawStatus = str(payment.status)?.toLowerCase() ?? null;
  const status = rawStatus && rawStatus in WIAPY_STATUS ? WIAPY_STATUS[rawStatus as keyof typeof WIAPY_STATUS] : null;
  const paymentId = str(payment.id);
  return { kind: paymentId && status ? "order" : "invalid", event: rawStatus ? `payment_${rawStatus}` : null, paymentId, rawStatus, status, isTest };
}

/** IDs que podem ligar a venda a uma oferta: produto (checkout.id) primeiro, depois bumps e entregáveis. */
export function wiapyProductIds(body: unknown): { checkoutId: string | null; bumpIds: string[]; deliverableIds: string[] } {
  const b = obj(body);
  const checkout = obj(b.checkout);
  const bumps = Array.isArray(checkout.orderbump) ? checkout.orderbump : [];
  const prods = Array.isArray(b.products) ? b.products : [];
  return {
    checkoutId: str(checkout.id),
    bumpIds: bumps.map((x) => str(obj(x).id)).filter((x): x is string => !!x),
    deliverableIds: prods.map((x) => str(obj(x).id)).filter((x): x is string => !!x),
  };
}

const SESSION_RE = /^[A-Za-z0-9._~-]{8,64}$/;
const TERM_SID_RE = /(?:^|\|)sid_([A-Za-z0-9._~-]{8,64})$/;

/** utm_term = "<posicionamento>|sid_<sessão>" (ou só "sid_<sessão>"): separa as duas coisas. */
export function splitTermSession(term: string | null | undefined): { term: string | null; sessionId: string | null } {
  const t = str(term);
  if (!t) return { term: null, sessionId: null };
  let decoded = t;
  try { decoded = decodeURIComponent(t.replace(/\+/g, " ")); } catch { /* mantém */ }
  const m = decoded.match(TERM_SID_RE);
  if (!m) return { term: t, sessionId: null };
  const rest = decoded.slice(0, m.index).trim();
  return { term: rest || null, sessionId: SESSION_RE.test(m[1]) ? m[1] : null };
}

/** fbclid de um fbc "fb.1.<ms>.<fbclid>" (o fbclid pode ter pontos). */
export function fbclidFromFbc(fbc: string | null | undefined): string | null {
  const s = str(fbc);
  if (!s) return null;
  const parts = s.split(".");
  if (parts.length < 4 || parts[0] !== "fb") return null;
  const id = parts.slice(3).join(".");
  return id.length >= 8 ? id : null;
}

export type WiapyTracking = {
  ip: string | null;
  userAgent: string | null;
  fbc: string | null;
  fbp: string | null;
  utms: { utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_term: string | null; utm_content: string | null };
  /** Sessão do tracker que veio dentro do utm_term (caminho principal de atribuição da Wiapy). */
  termSessionId: string | null;
};

export function wiapyTracking(body: unknown): WiapyTracking {
  const t = obj(obj(body).tracking);
  const term = splitTermSession(str(t.utm_term));
  return {
    ip: str(t.ip)?.slice(0, 64) ?? null,
    userAgent: str(t.useragent ?? t.user_agent)?.slice(0, 400) ?? null,
    fbc: str(t.fbc),
    fbp: str(t.fbp),
    utms: {
      utm_source: str(t.utm_source),
      utm_medium: str(t.utm_medium),
      utm_campaign: str(t.utm_campaign),
      utm_term: term.term,
      utm_content: str(t.utm_content),
    },
    termSessionId: term.sessionId,
  };
}

/**
 * Uma venda da Wiapy vira 1 pedido principal (external_order_id = payment.id) + 1 pedido por order bump
 * (`<payment.id>:<bump.id>`, offer_type orderbump), como a Cakto manda. O valor do principal = total − bumps; a taxa é rateada.
 * Sem bumps (ou bumps que não fecham com o total), um pedido só com o total.
 */
export function normalizeWiapyOrders(
  body: unknown,
  opts: { eventAt?: string | null; callback?: string | null } = {},
): { orders: NormalizedOrder[] } | { error: string } {
  const env = parseWiapyEnvelope(body);
  if (env.kind !== "order" || !env.paymentId || !env.status) return { error: env.kind === "abandonment" ? "abandonment" : `invalid_payment:${env.rawStatus ?? ""}` };
  const b = obj(body);
  const payment = obj(b.payment);
  const customer = obj(b.customer);
  const checkout = obj(b.checkout);
  const tr = wiapyTracking(body);

  const total = wiapyMoney(payment.amount) ?? wiapyMoney(checkout.amount);
  const fee = wiapyMoney(payment.fee);
  const discount = [payment.coupon_discount, payment.payment_method_discount, payment.orderbump_all_discount].map(wiapyMoney).filter((v): v is number => v != null).reduce((a, c) => a + c, 0);
  const bumps = (Array.isArray(checkout.orderbump) ? checkout.orderbump : [])
    .map((x) => ({ id: str(obj(x).id), title: str(obj(x).title), amount: wiapyMoney(obj(x).amount) }))
    .filter((x): x is { id: string; title: string | null; amount: number | null } => !!x.id);
  const bumpSum = Math.round(bumps.reduce((a, x) => a + (x.amount ?? 0), 0) * 100) / 100;
  const split = bumps.length > 0 && total != null && bumps.every((x) => x.amount != null && x.amount > 0) && bumpSum < total;

  const email = normalizeEmail(customer.email);
  const phone = normalizePhone(customer.mobile_phone ?? customer.phone);
  const name = splitName(str(customer.name));
  const created = iso(payment.dt_create);
  const updated = iso(payment.dt_update);
  const eventTs = opts.eventAt ?? updated ?? created;
  const status = env.status;
  const installments = Number(payment.installments);

  const base = (id: string, gross: number | null, fees: number | null): NormalizedOrder => ({
    provider: "wiapy",
    external_order_id: id,
    ref_id: env.paymentId!.slice(-8),
    status,
    raw_status: env.rawStatus,
    offer_type: "main",
    parent_order: null,
    product_external_id: str(checkout.id),
    product_short_id: null,
    product_name: str(checkout.title),
    offer_external_id: null,
    offer_name: null,
    checkout_id: str(checkout.id),
    currency: "BRL",
    base_amount: gross,
    gross_amount: gross,
    fees,
    discount: null,
    net_amount: gross != null ? Math.round((gross - (fees ?? 0)) * 100) / 100 : null,
    payment_method: str(payment.payment_method)?.toLowerCase() ?? null,
    installments: Number.isFinite(installments) && payment.installments != null ? installments : null,
    callback: opts.callback && SESSION_RE.test(opts.callback) ? opts.callback : null,
    customer_email_sha256: email ? sha256Hex(email) : null,
    customer_phone_sha256: phone ? sha256Hex(phone) : null,
    customer_fn_sha256: hashForMeta(name.first),
    customer_ln_sha256: hashForMeta(name.last),
    provider_created_at: created,
    paid_at: status === "paid" ? updated ?? eventTs : null,
    refund_requested_at: null,
    refunded_at: status === "refunded" ? eventTs : null,
    chargedback_at: status === "chargedback" ? eventTs : null,
    canceled_at: null,
    provider_updated_at: updated,
    event_at: eventTs,
    attribution: { ...tr.utms, sck: opts.callback ?? null, fbc: tr.fbc, fbp: tr.fbp },
    checkout_url: null,
  });

  if (!split) {
    const o = base(env.paymentId, total, fee);
    o.discount = discount ? Math.round(discount * 100) / 100 : null;
    return { orders: [o] };
  }
  const mainGross = Math.round((total! - bumpSum) * 100) / 100;
  const share = (part: number) => (fee == null || !total ? null : Math.round(fee * (part / total) * 100) / 100);
  const main = base(env.paymentId, mainGross, share(mainGross));
  main.discount = discount ? Math.round(discount * 100) / 100 : null;
  const out = [main];
  for (const x of bumps) {
    const o = base(`${env.paymentId}:${x.id}`, x.amount, share(x.amount!));
    Object.assign(o, { offer_type: "orderbump", parent_order: env.paymentId, product_external_id: x.id, product_name: x.title, checkout_id: x.id });
    out.push(o);
  }
  return { orders: out };
}

/** Reduz PII antes de guardar o payload para auditoria (sem e-mail, telefone, documento, IP, UA, PIX). */
export function redactWiapyPayload(body: unknown): unknown {
  if (!isObject(body)) return body;
  const c = obj(body.customer);
  const email = normalizeEmail(c.email);
  const phone = normalizePhone(c.mobile_phone);
  const out: Record<string, unknown> = { ...body };
  out.customer = isObject(body.customer) ? { id: c.id ?? null, email_sha256: email ? sha256Hex(email) : null, phone_sha256: phone ? sha256Hex(phone) : null, test: isWiapyTestBuyer(c.email) } : body.customer ?? null;
  if (isObject(body.payment)) {
    const pay = { ...body.payment };
    if ("pix_boleto" in pay) pay.pix_boleto = "[redacted]";
    out.payment = pay;
  }
  if (isObject(body.tracking)) {
    const t = { ...body.tracking };
    for (const k of ["ip", "useragent", "user_agent", "fbc", "fbp"]) if (k in t) t[k] = t[k] ? "[present]" : null;
    out.tracking = t;
  }
  return out;
}
