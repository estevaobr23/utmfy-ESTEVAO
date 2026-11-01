// Catálogo dos meios de pagamento (Cakto + Hotmart). Regra: NUNCA agrupar em "Outros".
// Meio conhecido → nome e cor próprios; desconhecido → o nome que a plataforma mandou, legível (ex.: SAMSUNG_PAY → "Samsung Pay").

export type PaymentMethodInfo = { key: string; label: string; color: string; hint?: string };

const KNOWN: Record<string, PaymentMethodInfo> = {
  pix: { key: "pix", label: "Pix", color: "#32bcad" },
  card: { key: "card", label: "Cartão de crédito", color: "#005ae3" },
  debit: { key: "debit", label: "Cartão de débito", color: "#3d7dde" },
  boleto: { key: "boleto", label: "Boleto", color: "#a3a6b4" },
  boleto_financed: { key: "boleto_financed", label: "Boleto parcelado", color: "#82868b" },
  paypal: { key: "paypal", label: "PayPal", color: "#0070e0" },
  mercadopago: { key: "mercadopago", label: "Mercado Pago", color: "#00b1ea" },
  applepay: { key: "applepay", label: "Apple Pay", color: "#e6e6e6" },
  googlepay: { key: "googlepay", label: "Google Pay", color: "#4285f4" },
  samsungpay: { key: "samsungpay", label: "Samsung Pay", color: "#1428a0" },
  picpay: { key: "picpay", label: "PicPay", color: "#21c25e" },
  nequi: { key: "nequi", label: "Nequi", color: "#da0081" },
  machpay: { key: "machpay", label: "Mach Pay", color: "#6b2fd6" },
  cash: { key: "cash", label: "Dinheiro (OXXO / Efecty)", color: "#ff9f43", hint: "Voucher pago em dinheiro em loja (México, Colômbia…)" },
  transfer: { key: "transfer", label: "Transferência bancária", color: "#7367f0" },
  klarna: { key: "klarna", label: "Klarna", color: "#ffb3c7" },
  hotcard: { key: "hotcard", label: "Hotcard", color: "#f04e23" },
  installment: { key: "installment", label: "Parcelado Hotmart", color: "#ef6a3a" },
  direct_debit: { key: "direct_debit", label: "Débito em conta", color: "#00cfe8" },
  wallet: { key: "wallet", label: "Carteira digital", color: "#28c76f" },
  hybrid: { key: "hybrid", label: "Pagamento combinado", color: "#b38bff" },
  unknown: { key: "unknown", label: "Não informado", color: "#5e6475" },
};

const ALIASES: Record<string, keyof typeof KNOWN> = {
  pix: "pix", pix_auto: "pix", pix_automatico: "pix",
  credit_card: "card", creditcard: "card", card: "card", cartao: "card", "cartão": "card", cartao_de_credito: "card",
  debit_card: "debit", debitcard: "debit",
  boleto: "boleto", bank_slip: "boleto", billet: "boleto",
  financed_billet: "boleto_financed", boleto_parcelado: "boleto_financed",
  paypal: "paypal", paypal_internacional: "paypal", paypal_international: "paypal",
  mercado_pago: "mercadopago", mercadopago: "mercadopago", mercadopago_wallet: "mercadopago", mercado_pago_wallet: "mercadopago",
  applepay: "applepay", apple_pay: "applepay",
  googlepay: "googlepay", google_pay: "googlepay",
  samsungpay: "samsungpay", samsung_pay: "samsungpay",
  picpay: "picpay",
  nequi: "nequi",
  mach_pay: "machpay", machpay: "machpay", mach: "machpay",
  cashpayment: "cash", cash_payment: "cash", cash: "cash", oxxo: "cash", efecty: "cash",
  bank_transfer: "transfer", direct_bank_transfer: "transfer", manual_transfer: "transfer", transfer: "transfer", wire_transfer: "transfer", spei: "transfer", pse: "transfer",
  klarna: "klarna",
  hotcard: "hotcard",
  financed_installment: "installment",
  direct_debit: "direct_debit",
  wallet: "wallet",
  hybrid: "hybrid",
};

const normalizeKey = (raw: string) => raw.trim().toLocaleLowerCase("pt-BR").replace(/[\s-]+/g, "_");

/** "SAMSUNG_PAY" → "Samsung Pay" (para meio que ainda não está no catálogo). */
export function prettifyMethod(raw: string): string {
  return raw.trim().replace(/[_-]+/g, " ").toLocaleLowerCase("pt-BR").replace(/(^|\s)\p{L}/gu, (m) => m.toLocaleUpperCase("pt-BR"));
}

export function paymentMethod(raw: string | null | undefined): PaymentMethodInfo {
  if (!raw || !raw.trim()) return KNOWN.unknown;
  const key = normalizeKey(raw);
  const known = ALIASES[key];
  if (known) return KNOWN[known];
  return { key: `raw:${key}`, label: prettifyMethod(raw), color: "#82868b" };
}

/** Info a partir da chave já classificada (a mesma de `paymentMethod(...).key`). */
export function paymentByKey(key: string): PaymentMethodInfo {
  if (KNOWN[key]) return KNOWN[key];
  if (key.startsWith("raw:")) return { key, label: prettifyMethod(key.slice(4)), color: "#82868b" };
  return paymentMethod(key);
}
