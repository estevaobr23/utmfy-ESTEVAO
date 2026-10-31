// Normalização defensiva do webhook da Hotmart (v2.0.0).
// Envelope: { id, creation_date (epoch ms), event, version, hottok?, data: { product, buyer, purchase, commissions, ... } }
// Referência: https://developers.hotmart.com/docs/pt-BR/1.0.0/webhook/about-webhook/
//  * o evento (PURCHASE_APPROVED, PURCHASE_REFUNDED, ...) define o status; `purchase.status` só entra como raw_status
//  * datas vêm em epoch milissegundos
//  * a Hotmart NÃO repassa utm_*: a atribuição vem do `sck` (sessão do tracker) em purchase.origin.sck
import { sha256Hex } from "../hash";
import { hashForMeta, splitName } from "../capi";
import { toMoney } from "../money";
import { normalizeEmail, type NormalizedOrder, type OrderStatus } from "../cakto/normalize";

export const HOTMART_EVENTS = {
  PURCHASE_APPROVED: "paid",
  PURCHASE_COMPLETE: "paid",
  PURCHASE_BILLET_PRINTED: "pending",
  PURCHASE_DELAYED: "pending",
  PURCHASE_CANCELED: "canceled",
  PURCHASE_EXPIRED: "canceled",
  PURCHASE_REFUNDED: "refunded",
  PURCHASE_CHARGEBACK: "chargedback",
  PURCHASE_PROTEST: "disputed",
} as const satisfies Record<string, OrderStatus>;

export type HotmartEnvelope = {
  hottok: string | null;
  eventId: string | null;
  event: string | null;
  /** creation_date do envelope (momento em que a Hotmart emitiu o evento). */
  eventAt: string | null;
  data: Record<string, unknown> | null;
  kind: "order" | "abandonment" | "ignored" | "invalid";
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const obj = (v: unknown): Record<string, unknown> => (isObject(v) ? v : {});
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** epoch ms (number ou string numérica) ou ISO → ISO. */
export function hotmartDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : /^\d{9,}$/.test(String(v).trim()) ? Number(String(v).trim()) : null;
  const d = n != null ? new Date(n < 1e11 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseHotmartEnvelope(body: unknown): HotmartEnvelope {
  if (!isObject(body)) return { hottok: null, eventId: null, event: null, eventAt: null, data: null, kind: "invalid" };
  const event = str(body.event);
  const base = { hottok: str(body.hottok), eventId: str(body.id), event, eventAt: hotmartDate(body.creation_date) };
  const data = isObject(body.data) ? body.data : null;
  if (!event || !data) return { ...base, data, kind: "invalid" };
  if (event === "PURCHASE_OUT_OF_SHOPPING_CART") return { ...base, data, kind: "abandonment" };
  if (event in HOTMART_EVENTS) return { ...base, data, kind: "order" };
  return { ...base, data, kind: "ignored" };
}

/** ID do produto Hotmart (numérico, em texto) de um envelope, para decidir a oferta antes de gravar qualquer coisa. */
export function hotmartProductId(data: Record<string, unknown> | null): string | null {
  return str(obj(data?.product).id);
}
export function hotmartOfferCode(data: Record<string, unknown> | null): string | null {
  return str(obj(obj(data?.purchase).offer).code);
}

/** Telefone só com dígitos e DDI. A Hotmart manda DDI separado (checkout_phone_code); sem DDI não inventamos um. */
export function normalizeHotmartPhone(phone: unknown, code?: unknown): string | null {
  const digits = str(phone)?.replace(/\D/g, "") ?? "";
  if (digits.length < 8) return null;
  const ddi = str(code)?.replace(/\D/g, "") ?? "";
  return ddi && !digits.startsWith(ddi) ? ddi + digits : digits;
}

const SESSION_RE = /^[A-Za-z0-9._~-]{8,64}$/;

export function normalizeHotmartOrder(
  data: Record<string, unknown>,
  opts: { eventName?: string | null; eventAt?: string | null; mainProductIds?: string[] } = {},
): { order: NormalizedOrder } | { error: string } {
  const purchase = obj(data.purchase);
  const product = obj(data.product);
  const buyer = obj(data.buyer);
  const offer = obj(purchase.offer);
  const origin = obj(purchase.origin);
  const payment = obj(purchase.payment);
  const price = obj(purchase.price);
  const bump = obj(purchase.order_bump);

  const id = str(purchase.transaction);
  if (!id) return { error: "missing_order_id" };
  const status = opts.eventName && opts.eventName in HOTMART_EVENTS ? HOTMART_EVENTS[opts.eventName as keyof typeof HOTMART_EVENTS] : null;
  if (!status) return { error: `unknown_event:${String(opts.eventName ?? "")}` };

  const priceCurrency = (str(price.currency_value) ?? str(price.currency_code) ?? "BRL").toUpperCase();
  let currency = priceCurrency;
  let gross = toMoney(price.value);

  // O que o produtor recebe é a comissão PRODUCER; taxas = cobrado − comissão (mesmo critério da Cakto). Só vale na mesma moeda.
  const commissions = Array.isArray(data.commissions) ? (data.commissions as Record<string, unknown>[]) : [];
  const commCurrency = (c: Record<string, unknown>) => String(c.currency_code ?? c.currency_value ?? "").toUpperCase();

  // Comprador pagou em moeda local (ARS, UYU, MXN...) e a Hotmart repassa ao produtor na moeda da conta (comissões em USD):
  // vale o que o produtor recebe. Sem isso o pedido ficava em moeda sem cotação e sumia do painel.
  const payoutCurrency = !(price.currency_value ?? price.currency_code) ? undefined : commissions.map((c) => (isObject(c) ? commCurrency(c) : "")).find((c) => c && c !== priceCurrency);
  let payoutNet: number | null = null;
  let payoutFees: number | null = null;
  if (payoutCurrency) {
    const sameCur = commissions.filter((c) => isObject(c) && commCurrency(c) === payoutCurrency) as Record<string, unknown>[];
    const val = (c: Record<string, unknown>) => toMoney(c.value) ?? 0;
    const net = sameCur.filter((c) => String(c.source ?? "").toUpperCase() === "PRODUCER");
    if (net.length) {
      payoutNet = Math.round(net.reduce((a, c) => a + val(c), 0) * 100) / 100;
      payoutFees = Math.round(sameCur.filter((c) => !net.includes(c)).reduce((a, c) => a + val(c), 0) * 100) / 100;
      currency = payoutCurrency;
      gross = Math.round((payoutNet + payoutFees) * 100) / 100;
    }
  }

  const producerNets = payoutNet != null ? [payoutNet] : commissions
    .filter((c) => isObject(c) && String(c.source ?? "").toUpperCase() === "PRODUCER" && (!(c.currency_code ?? c.currency_value) || String(c.currency_code ?? c.currency_value).toUpperCase() === currency))
    .map((c) => toMoney(c.value))
    .filter((v): v is number => v != null);
  const producerNet = producerNets.length ? producerNets.reduce((a, b) => a + b, 0) : null;
  const feeObj = obj(purchase.hotmart_fee);
  const feeSameCurrency = !feeObj.currency_code || String(feeObj.currency_code).toUpperCase() === currency;
  const fees = payoutFees ?? (gross != null && producerNet != null ? Math.round((gross - producerNet) * 100) / 100 : feeSameCurrency ? toMoney(feeObj.total) : null);

  const email = normalizeEmail(buyer.email);
  const phone = normalizeHotmartPhone(buyer.checkout_phone ?? buyer.phone, buyer.checkout_phone_code ?? buyer.phone_code);
  const name = splitName(str(buyer.name) ?? [str(buyer.first_name), str(buyer.last_name)].filter(Boolean).join(" "));

  const sck = str(origin.sck);
  const eventTs = opts.eventAt ?? null;
  const approved = hotmartDate(purchase.approved_date);
  const created = hotmartDate(purchase.order_date);
  // Tipo do pedido: com a lista de produtos PRINCIPAIS, vale o produto. A Hotmart marca `is_order_bump: true` até no produto
  // principal quando o carrinho tem bump (HP…C1), o que escondia essa venda do painel ("vendas" = só offer_type main).
  // Produto fora da lista (guia, Kit) é complemento: soma no faturamento, mas não conta como venda no CPA.
  const productId = str(product.id);
  const isBump = opts.mainProductIds?.length ? !(productId && opts.mainProductIds.includes(productId)) : bump.is_order_bump === true;

  const order: NormalizedOrder = {
    provider: "hotmart",
    external_order_id: id,
    ref_id: null,
    status,
    raw_status: str(purchase.status),
    offer_type: isBump ? "orderbump" : "main",
    parent_order: isBump ? str(bump.parent_purchase_transaction) : null,
    product_external_id: str(product.id),
    product_short_id: null,
    product_name: str(product.name),
    offer_external_id: str(offer.code),
    offer_name: null,
    checkout_id: null,
    currency,
    base_amount: (str(obj(purchase.original_offer_price).currency_value ?? obj(purchase.original_offer_price).currency_code)?.toUpperCase() ?? currency) === currency
      ? toMoney(purchase.original_offer_price ? obj(purchase.original_offer_price).value : null) ?? gross
      : gross,
    gross_amount: gross,
    fees,
    discount: null,
    net_amount: gross != null ? Math.round((gross - (fees ?? 0)) * 100) / 100 : null,
    payment_method: str(payment.type),
    installments: Number.isFinite(Number(payment.installments_number)) && payment.installments_number != null ? Number(payment.installments_number) : null,
    callback: sck && SESSION_RE.test(sck) ? sck : null,
    customer_email_sha256: email ? sha256Hex(email) : null,
    customer_phone_sha256: phone ? sha256Hex(phone) : null,
    customer_fn_sha256: hashForMeta(name.first),
    customer_ln_sha256: hashForMeta(name.last),
    provider_created_at: created,
    paid_at: status === "paid" ? approved ?? eventTs : null,
    refund_requested_at: null,
    refunded_at: status === "refunded" ? eventTs : null,
    chargedback_at: status === "chargedback" ? eventTs : null,
    canceled_at: status === "canceled" ? eventTs : null,
    provider_updated_at: eventTs,
    event_at: eventTs ?? approved ?? created,
    attribution: { utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null, sck, fbc: null, fbp: null },
    checkout_url: null,
  };
  return { order };
}

/** Remove hottok e reduz PII antes de guardar o payload para auditoria. */
export function redactHotmartPayload(body: unknown): unknown {
  if (!isObject(body)) return body;
  const { hottok: _hottok, ...rest } = body;
  void _hottok;
  const data = obj(rest.data);
  const out: Record<string, unknown> = { ...data };
  const buyer = obj(data.buyer);
  const addr = obj(buyer.address);
  out.buyer = {
    ucode: buyer.ucode ?? null,
    email_sha256: (() => { const e = normalizeEmail(buyer.email); return e ? sha256Hex(e) : null; })(),
    phone_sha256: (() => { const p = normalizeHotmartPhone(buyer.checkout_phone ?? buyer.phone, buyer.checkout_phone_code); return p ? sha256Hex(p) : null; })(),
    country: addr.country_iso ?? addr.country ?? null,
  };
  if ("producer" in data) out.producer = "[redacted]";
  if (Array.isArray(data.affiliates)) out.affiliates = data.affiliates.map((a) => (isObject(a) ? { affiliate_code: a.affiliate_code ?? null } : a));
  if (isObject(data.subscription)) {
    const sub = { ...data.subscription };
    delete sub.subscriber;
    out.subscription = sub;
  }
  const purchase = obj(data.purchase);
  if (isObject(data.purchase)) {
    const pay = { ...obj(purchase.payment) };
    for (const k of ["billet_url", "billet_barcode", "pix_code", "pix_qrcode", "pix_expiration_date", "refusal_reason"]) if (k in pay) pay[k] = "[redacted]";
    out.purchase = { ...purchase, payment: pay };
  }
  return { ...rest, data: out };
}
