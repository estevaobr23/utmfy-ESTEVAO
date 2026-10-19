// Normalização defensiva do webhook/API da Cakto.
// Referência: https://docs.cakto.com.br/conceitos/webhooks (lida em 2026-09-30)
//  * envelope { secret, event, data }; data = objeto (V1) ou array (V2)
//  * valores: baseAmount/amount/fees = number; discount/charged_fees/interest = string
//  * checkout_abandonment tem forma própria (sem id/status) → ignorado aqui
import { sha256Hex } from "../hash";
import { hashForMeta, splitName } from "../capi";
import { toMoney } from "../money";

export type OrderStatus =
  | "pending"
  | "refused"
  | "canceled"
  | "paid"
  | "refund_requested"
  | "disputed"
  | "refunded"
  | "chargedback";

export const CAKTO_EVENTS = {
  purchase_approved: "paid",
  pix_gerado: "pending",
  boleto_gerado: "pending",
  picpay_gerado: "pending",
  openfinance_nubank_gerado: "pending",
  purchase_refused: "refused",
  refund: "refunded",
  refund_requested: "refund_requested",
  chargeback: "chargedback",
  subscription_renewed: "paid",
  subscription_renewal_refused: "refused",
} as const satisfies Record<string, OrderStatus>;

const RAW_STATUS_MAP: Record<string, OrderStatus> = {
  processing: "pending",
  authorized: "pending",
  waiting_payment: "pending",
  scheduled: "pending",
  retrying: "pending",
  partially_paid: "pending",
  paid: "paid",
  refused: "refused",
  blocked: "refused",
  acquirer_error: "refused",
  canceled: "canceled",
  refund_requested: "refund_requested",
  in_settlement: "refund_requested",
  prechargeback: "disputed",
  med: "disputed",
  in_protest: "disputed",
  refunded: "refunded",
  chargedback: "chargedback",
};

export function normalizeStatus(rawStatus: unknown, eventName?: string | null): OrderStatus | null {
  if (typeof rawStatus === "string" && rawStatus.trim() !== "") {
    const s = RAW_STATUS_MAP[rawStatus.trim().toLowerCase()];
    if (s) return s;
  }
  if (eventName && eventName in CAKTO_EVENTS) return CAKTO_EVENTS[eventName as keyof typeof CAKTO_EVENTS];
  return null;
}

export type CaktoEnvelope = {
  secret: string | null;
  event: string | null;
  items: Record<string, unknown>[];
  kind: "order" | "abandonment" | "invalid";
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseEnvelope(body: unknown): CaktoEnvelope {
  if (!isObject(body)) return { secret: null, event: null, items: [], kind: "invalid" };
  const secret = typeof body.secret === "string" ? body.secret : null;
  const event = typeof body.event === "string" ? body.event : null;
  const raw = body.data;
  const items = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).filter(isObject);
  if (event === "checkout_abandonment") return { secret, event, items, kind: "abandonment" };
  if (items.length === 0) return { secret, event, items, kind: "invalid" };
  return { secret, event, items, kind: "order" };
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function iso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function obj(v: unknown): Record<string, unknown> {
  return isObject(v) ? v : {};
}

export function normalizeEmail(email: unknown): string | null {
  const e = str(email)?.toLowerCase();
  return e && e.includes("@") ? e : null;
}

/** Telefone só com dígitos, com DDI. Números BR de 10/11 dígitos recebem 55. */
export function normalizePhone(phone: unknown): string | null {
  const digits = str(phone)?.replace(/\D/g, "") ?? "";
  if (digits.length < 8) return null;
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) return "55" + digits;
  return digits;
}

export type NormalizedOrder = {
  provider: "cakto";
  external_order_id: string;
  ref_id: string | null;
  status: OrderStatus;
  raw_status: string | null;
  offer_type: string | null;
  parent_order: string | null;
  product_external_id: string | null;
  product_short_id: string | null;
  product_name: string | null;
  offer_external_id: string | null;
  offer_name: string | null;
  checkout_id: string | null;
  currency: string;
  base_amount: number | null;
  gross_amount: number | null;
  fees: number | null;
  discount: number | null;
  net_amount: number | null;
  payment_method: string | null;
  installments: number | null;
  callback: string | null;
  customer_email_sha256: string | null;
  customer_phone_sha256: string | null;
  customer_fn_sha256: string | null;
  customer_ln_sha256: string | null;
  provider_created_at: string | null;
  paid_at: string | null;
  refund_requested_at: string | null;
  refunded_at: string | null;
  chargedback_at: string | null;
  canceled_at: string | null;
  provider_updated_at: string | null;
  event_at: string | null;
  attribution: {
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
    sck: string | null;
    fbc: string | null;
    fbp: string | null;
  };
  checkout_url: string | null;
};

/** Extrai o id da oferta de um link pay.cakto.com.br/<offerId>?... (usado na API, que não traz `offer`). */
export function offerIdFromCheckoutUrl(url: unknown): string | null {
  const s = str(url);
  if (!s) return null;
  try {
    const u = new URL(s);
    const seg = u.pathname.split("/").filter(Boolean)[0];
    return seg && /^[A-Za-z0-9_-]{3,64}$/.test(seg) ? seg : null;
  } catch {
    return null;
  }
}

/**
 * Normaliza um item de pedido (webhook `data` ou item de /public_api/orders/).
 * `eventAt` = momento em que a Cakto emitiu o evento (X-Cakto-Timestamp) ou
 * momento da leitura na API. É usado para ordenar transições do mesmo nível.
 */
export function normalizeCaktoOrder(
  data: Record<string, unknown>,
  opts: { eventName?: string | null; eventAt?: string | null } = {},
): { order: NormalizedOrder } | { error: string } {
  const id = str(data.id);
  if (!id) return { error: "missing_order_id" };
  const status = normalizeStatus(data.status, opts.eventName);
  if (!status) return { error: `unknown_status:${String(data.status ?? "")}` };

  const product = obj(data.product);
  const offer = obj(data.offer);
  const customer = obj(data.customer);
  const refundRequest = obj(data.refundRequest);

  const gross = toMoney(data.amount);
  // O valor cobrado inclui a taxa de serviço que o comprador paga à Cakto (ex.: R$ 0,99),
  // que não está em `fees`. O que o produtor recebe é a comissão "producer": quando ela
  // vier, as taxas efetivas = cobrado − comissão (mesmo líquido que a UTMify mostra).
  const commissions = Array.isArray(data.commissions) ? (data.commissions as Record<string, unknown>[]) : [];
  const producer = commissions.filter((c) => c?.type === "producer").map((c) => toMoney(c.commissionValue)).filter((v): v is number => v != null);
  const producerNet = producer.length ? producer.reduce((a, b) => a + b, 0) : null;
  const fees = gross != null && producerNet != null ? Math.round((gross - producerNet) * 100) / 100 : toMoney(data.fees);
  const email = normalizeEmail(customer.email);
  const phone = normalizePhone(customer.phone);
  // Nome só entra como hash (primeiro e último): a Meta o usa para casar a compra; o texto em claro nunca é gravado.
  const name = splitName(str(customer.name) ?? str(data.customerName));

  const statusTs =
    status === "paid" ? iso(data.paidAt)
    : status === "refunded" ? iso(data.refundedAt)
    : status === "chargedback" ? iso(data.chargedbackAt)
    : status === "canceled" ? iso(data.canceledAt)
    : status === "refund_requested" ? iso(refundRequest.requestedAt) ?? iso(data.refundRequestedAt)
    : null;

  const order: NormalizedOrder = {
    provider: "cakto",
    external_order_id: id,
    ref_id: str(data.refId),
    status,
    raw_status: str(data.status),
    offer_type: str(data.offer_type)?.toLowerCase() ?? null,
    parent_order: str(data.parent_order),
    product_external_id: str(product.id),
    product_short_id: str(product.short_id),
    product_name: str(product.name),
    offer_external_id: str(offer.id) ?? offerIdFromCheckoutUrl(data.checkoutUrl),
    offer_name: str(offer.name),
    checkout_id: str(data.checkout),
    currency: (str(offer.currency) ?? str(product.currency) ?? "BRL").toUpperCase(),
    base_amount: toMoney(data.baseAmount),
    gross_amount: gross,
    fees,
    discount: toMoney(data.discount),
    net_amount: gross != null ? Math.round((gross - (fees ?? 0)) * 100) / 100 : null,
    payment_method: str(data.paymentMethod),
    installments: Number.isFinite(Number(data.installments)) && data.installments != null ? Number(data.installments) : null,
    callback: str(data.callback),
    customer_email_sha256: email ? sha256Hex(email) : null,
    customer_phone_sha256: phone ? sha256Hex(phone) : null,
    customer_fn_sha256: hashForMeta(name.first),
    customer_ln_sha256: hashForMeta(name.last),
    provider_created_at: iso(data.createdAt),
    paid_at: iso(data.paidAt),
    refund_requested_at: iso(refundRequest.requestedAt) ?? iso(data.refundRequestedAt),
    refunded_at: iso(data.refundedAt),
    chargedback_at: iso(data.chargedbackAt),
    canceled_at: iso(data.canceledAt),
    provider_updated_at: iso(data.updatedAt),
    event_at: opts.eventAt ?? statusTs ?? iso(data.updatedAt) ?? iso(data.createdAt),
    attribution: {
      utm_source: str(data.utm_source),
      utm_medium: str(data.utm_medium),
      utm_campaign: str(data.utm_campaign),
      utm_term: str(data.utm_term),
      utm_content: str(data.utm_content),
      sck: str(data.sck),
      fbc: str(data.fbc),
      fbp: str(data.fbp),
    },
    checkout_url: str(data.checkoutUrl),
  };
  return { order };
}

/** Remove secret e reduz PII antes de guardar o payload para auditoria. */
export function redactPayload(body: unknown): unknown {
  if (!isObject(body)) return body;
  const redactItem = (item: unknown) => {
    if (!isObject(item)) return item;
    const c = obj(item.customer);
    const email = normalizeEmail(c.email ?? item.customerEmail);
    const phone = normalizePhone(c.phone ?? item.customerCellphone);
    const out: Record<string, unknown> = { ...item };
    out.customer = isObject(item.customer)
      ? { id: c.id ?? null, email_sha256: email ? sha256Hex(email) : null, phone_sha256: phone ? sha256Hex(phone) : null }
      : item.customer ?? null;
    delete out.customerName;
    delete out.customerEmail;
    delete out.customerCellphone;
    if (isObject(item.address)) out.address = { country: item.address.country ?? null, state: item.address.state ?? null };
    if (isObject(item.shipping)) out.shipping = "[redacted]";
    if (isObject(item.card)) out.card = { brand: item.card.brand ?? null };
    for (const k of ["pix", "boleto", "picpay", "openFinanceNubank"]) if (k in item) out[k] = "[redacted]";
    if (isObject(item.subscription)) {
      const sub = { ...item.subscription };
      delete sub.customer;
      out.subscription = sub;
    }
    if (Array.isArray(item.commissions)) {
      out.commissions = item.commissions.map((cm) => (isObject(cm) ? { ...cm, user: cm.user ? "[redacted]" : cm.user } : cm));
    }
    return out;
  };
  const { secret: _secret, ...rest } = body;
  void _secret;
  const data = rest.data;
  return { ...rest, data: Array.isArray(data) ? data.map(redactItem) : redactItem(data) };
}

/** Linha de `orders` já gravada (campos usados para saber se a reconciliação teria algo a mudar). */
export type ExistingOrder = {
  status: string;
  gross_amount: number | string | null;
  net_amount: number | string | null;
  fees: number | string | null;
  offer_id: string | null;
};

const sameMoney = (a: number | string | null | undefined, b: number | null | undefined) => {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - b) < 0.005;
};

export type OfferItemRow = { offer_id: string; cakto_product_id: string | null; cakto_offer_id: string | null };

/** Oferta interna de um produto/oferta da Cakto (oferta exata > mesma oferta Cakto > produto). Usada por `resolveOffer`. */
export function pickMappedOffer(rows: OfferItemRow[], productId: string | null, offerId: string | null): string | null {
  const exact = rows.find((r) => r.cakto_offer_id && r.cakto_offer_id === offerId && (!productId || r.cakto_product_id === productId));
  const byOffer = rows.find((r) => r.cakto_offer_id && r.cakto_offer_id === offerId);
  const byProduct = rows.find((r) => !r.cakto_offer_id && r.cakto_product_id === productId);
  return (exact ?? byOffer ?? byProduct)?.offer_id ?? null;
}

/**
 * Pedido da API igual ao que já está no banco (status, valores e vínculo com a oferta): reprocessar não muda nada.
 * `mappedOfferId` é a oferta que o mapeamento ATUAL daria: pedido sem oferta só é "igual" se continua sem mapeamento
 * (se o vínculo foi criado depois, precisa passar pelo caminho completo para ser atribuído).
 */
export function isUnchangedOrder(existing: ExistingOrder, incoming: Pick<NormalizedOrder, "status" | "gross_amount" | "net_amount" | "fees">, mappedOfferId: string | null): boolean {
  return (existing.offer_id != null || mappedOfferId == null)
    && existing.status === incoming.status
    && sameMoney(existing.gross_amount, incoming.gross_amount)
    && sameMoney(existing.net_amount, incoming.net_amount)
    && sameMoney(existing.fees, incoming.fees);
}
