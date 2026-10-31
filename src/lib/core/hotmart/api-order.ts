// API pública da Hotmart (vendas) → o mesmo formato `data` do webhook v2, para passar por `normalizeHotmartOrder`
// e gravar o pedido pelo MESMO caminho do webhook. A API não traz telefone/endereço do comprador no histórico.
//   GET /payments/api/v1/sales/history   → compra (status, preço pago na moeda do comprador, taxa, sck, oferta)
//   GET /payments/api/v1/sales/commissions → o que o produtor recebe (PRODUCER), na moeda da conta (USD)
// A taxa da Hotmart (`hotmart_fee.total`) vem na moeda do repasse: entra como comissão MARKETPLACE, o que reproduz o
// bruto = comissão + taxa que o webhook entrega (ex.: 8,04 + 0,99 = 9,03).

import { hotmartDate } from "./normalize";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type HotmartApiSale = {
  product?: { id?: number | string; name?: string };
  purchase?: Obj;
  buyer?: { name?: string; email?: string; ucode?: string };
};
export type HotmartApiCommission = {
  transaction?: string;
  commissions?: { source?: string; commission?: { currency_code?: string; value?: number } }[];
};

/** Status da API → evento do webhook equivalente (o evento é que define o status do pedido). */
export const HOTMART_API_STATUS_EVENT: Record<string, string> = {
  APPROVED: "PURCHASE_APPROVED",
  COMPLETE: "PURCHASE_COMPLETE",
  REFUNDED: "PURCHASE_REFUNDED",
  CHARGEBACK: "PURCHASE_CHARGEBACK",
  CANCELLED: "PURCHASE_CANCELED",
  EXPIRED: "PURCHASE_EXPIRED",
};

export function hotmartApiSaleToData(sale: HotmartApiSale, comm: HotmartApiCommission | null): { data: Obj; event: string | null; transaction: string | null } {
  const p = obj(sale.purchase);
  const price = obj(p.price);
  const fee = obj(p.hotmart_fee);
  const tracking = obj(p.tracking);
  const status = String(p.status ?? "").toUpperCase();

  const producer = (comm?.commissions ?? []).find((c) => String(c.source ?? "").toUpperCase() === "PRODUCER")?.commission;
  const commissions: Obj[] = [];
  if (producer && num(producer.value) != null && producer.currency_code) {
    commissions.push({ source: "PRODUCER", value: producer.value, currency_code: producer.currency_code });
    const feeTotal = num(fee.total);
    if (feeTotal != null) commissions.push({ source: "MARKETPLACE", value: feeTotal, currency_code: producer.currency_code });
  }

  const data: Obj = {
    product: { id: sale.product?.id != null ? String(sale.product.id) : null, name: sale.product?.name ?? null },
    buyer: { email: sale.buyer?.email ?? null, name: sale.buyer?.name ?? null },
    purchase: {
      transaction: p.transaction ?? null,
      status: p.status ?? null,
      approved_date: p.approved_date ?? null,
      order_date: p.order_date ?? null,
      offer: { code: obj(p.offer).code ?? null },
      price: { value: price.value ?? null, currency_value: price.currency_code ?? null, currency_code: price.currency_code ?? null },
      payment: { type: obj(p.payment).type ?? null, installments_number: obj(p.payment).installments_number ?? null },
      origin: { sck: tracking.source_sck ?? null },
    },
    commissions,
  };
  return { data, event: HOTMART_API_STATUS_EVENT[status] ?? null, transaction: typeof p.transaction === "string" ? p.transaction : null };
}

/** Data que a API informa para a venda (aprovação), em ISO; serve de `eventAt` do pedido novo. */
export const hotmartApiSaleDate = (sale: HotmartApiSale): string | null => hotmartDate(obj(sale.purchase).approved_date ?? obj(sale.purchase).order_date);
